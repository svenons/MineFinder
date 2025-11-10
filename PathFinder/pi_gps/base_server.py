#!/usr/bin/env python3
"""
Pi GPS Base Server (JSON Lines over Serial)
- Provides controller registry/selection
- Routes JSONL messages between serial and active controller
- Emits telemetry/path/status messages

Protocol v1 (JSONL, one object per line):
Client → Server:
  {"type":"hello","role":"client","app":"MineFinder","version":1}
  {"type":"select_controller","id":"gps_sim"}
  {"type":"configure","origin_gps":{lat,lon,alt?},"metres_per_cm":0.01,"simulate":true,"simulated_speed_ms":1.5,"mine_buffer_m":10,"telemetry_hz":5}
  {"type":"sim_mines","mines_gps":[{lat,lon,radius_m}]}
  {"type":"mission_start","start_gps":{lat,lon},"goal_gps":{lat,lon}}
  {"type":"mission_stop"}
  {"type":"mine_detected","at_gps":{lat,lon}}

Server → Client:
  {"type":"identify","version":1,"server":"PiGPS","controllers":[{id,name,capabilities:[]}]}
  {"type":"controller_list","controllers":[...]}
  {"type":"controller_selected","id":"gps_sim"}
  {"type":"configured","ok":true}
  {"type":"path_update","waypoints_gps":[{lat,lon},...],"reason":"initial|replan"}
  {"type":"telemetry","pos_gps":{lat,lon},"path_travelled_gps":[...],"path_active_gps":[...],"speed_ms":1.5,"ts":...}
  {"type":"nav_done"}
  {"type":"status","message":"..."}
  {"type":"error","message":"..."}
"""
from __future__ import annotations
import json
import threading
import time
from dataclasses import dataclass
from queue import Queue, Empty
from typing import Any, Dict, List, Optional
import logging

try:
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None  # type: ignore


@dataclass
class ServerConfig:
    port: str = "/dev/serial0"
    baud: int = 9600
    telemetry_hz: float = 5.0


class PiBaseServer:
    def __init__(self, cfg: ServerConfig):
        if serial is None:
            raise RuntimeError("pyserial not installed. pip install pyserial")
        self.cfg = cfg
        self.log = logging.getLogger(__name__)
        self.ser = serial.Serial(self.cfg.port, self.cfg.baud, timeout=0.2, write_timeout=0.5)
        self.log.info("Opened serial %s@%s", self.cfg.port, self.cfg.baud)
        self.rx_queue: Queue = Queue()
        self.stop_evt = threading.Event()
        self.reader = threading.Thread(target=self._reader_loop, daemon=True)
        self.reader.start()

        # Session state
        self.telemetry_hz: float = cfg.telemetry_hz
        self.origin_gps: Optional[Dict[str, float]] = None
        self.metres_per_cm: float = 0.01
        self.simulate: bool = False
        self.simulated_speed_ms: Optional[float] = None
        self.mine_buffer_m: float = 10.0

        # Controllers
        self.controllers: Dict[str, Any] = {}
        self.selected_id: Optional[str] = None
        self.active: Optional[Any] = None

        # For controller callbacks
        def emit(obj: Dict[str, Any]):
            self._send(obj)
        self.emit = emit

        self._last_tick = time.time()

    # ---------------- Serial I/O ----------------
    def _send(self, obj: Dict[str, Any]) -> None:
        try:
            self.log.debug("TX %s", obj.get("type"))
            line = json.dumps(obj) + "\n"
            self.ser.write(line.encode("utf-8"))
        except Exception as e:
            # Best-effort logging on stderr
            print(f"[PiBaseServer] write error: {e}")

    def _reader_loop(self):
        while not self.stop_evt.is_set():
            try:
                chunk = self.ser.readline()
                if not chunk:
                    continue
                try:
                    msg = json.loads(chunk.decode("utf-8", errors="ignore").strip())
                    if isinstance(msg, dict):
                        try:
                            self.log.debug("RX %s", msg.get("type"))
                        except Exception:
                            pass
                        self.rx_queue.put(msg)
                except Exception:
                    continue
            except Exception:
                time.sleep(0.05)

    # ---------------- Controller registry ----------------
    def register_controller(self, id_: str, controller_ctor):
        self.controllers[id_] = controller_ctor

    def _instantiate_controller(self, id_: str):
        ctor = self.controllers.get(id_)
        if not ctor:
            return None
        ctl = ctor(self.emit)
        return ctl

    # ---------------- Protocol handling ----------------
    def handle_msg(self, msg: Dict[str, Any]):
        t = msg.get("type")
        if t == "hello":
            self._send({
                "type": "identify",
                "version": 1,
                "server": "PiGPS",
                "controllers": [
                    {"id": cid, "name": cid, "capabilities": getattr(self.controllers.get(cid), "CAPS", ["gps_astar","telemetry"]) if hasattr(self.controllers.get(cid), "CAPS") else ["gps_astar","telemetry"]}
                    for cid in self.controllers.keys()
                ],
                "selected_controller": self.selected_id,
            })
        elif t == "select_controller":
            cid = str(msg.get("id", ""))
            ctl = self._instantiate_controller(cid)
            if ctl is None:
                self._send({"type": "error", "message": f"unknown controller {cid}"})
                return
            self.selected_id = cid
            self.active = ctl
            self._send({"type": "controller_selected", "id": cid})
        elif t == "configure":
            self.origin_gps = msg.get("origin_gps") or self.origin_gps
            self.metres_per_cm = float(msg.get("metres_per_cm", self.metres_per_cm))
            self.simulate = bool(msg.get("simulate", self.simulate))
            self.simulated_speed_ms = msg.get("simulated_speed_ms", self.simulated_speed_ms)
            self.mine_buffer_m = float(msg.get("mine_buffer_m", self.mine_buffer_m))
            self.telemetry_hz = float(msg.get("telemetry_hz", self.telemetry_hz))
            if self.active and hasattr(self.active, "configure"):
                try:
                    self.active.configure(origin_gps=self.origin_gps, metres_per_cm=self.metres_per_cm, simulate=self.simulate, simulated_speed_ms=self.simulated_speed_ms, mine_buffer_m=self.mine_buffer_m, telemetry_hz=self.telemetry_hz)
                except Exception as e:
                    self._send({"type":"error","message":f"configure failed: {e}"})
                    return
            self._send({"type":"configured","ok":True})
        elif t == "sim_mines":
            if self.active and hasattr(self.active, "set_sim_mines"):
                mines = msg.get("mines_gps") or []
                try:
                    self.active.set_sim_mines(mines)
                except Exception as e:
                    self._send({"type":"error","message":f"sim_mines failed: {e}"})
        elif t == "mission_start":
            if not self.active:
                self._send({"type":"error","message":"no controller selected"})
                return
            try:
                self.active.start_mission(msg.get("start_gps"), msg.get("goal_gps"))
            except Exception as e:
                self._send({"type":"error","message":f"mission_start failed: {e}"})
        elif t == "mission_stop":
            if self.active and hasattr(self.active, "stop_mission"):
                try:
                    self.active.stop_mission()
                except Exception:
                    pass
            self._send({"type":"status","message":"mission stopped"})
        elif t == "mine_detected":
            if self.active and hasattr(self.active, "ingest_event"):
                try:
                    self.active.ingest_event(msg)
                except Exception:
                    pass
        else:
            self._send({"type":"status","message":f"unknown type: {t}"})

    def _tick(self, dt: float):
        if self.active and hasattr(self.active, "tick"):
            try:
                self.active.tick(dt)
            except Exception as e:
                self._send({"type":"error","message":f"tick error: {e}"})

    def serve_forever(self):
        self._send({"type":"status","message":f"PiGPS ready on {self.cfg.port}@{self.cfg.baud}"})
        while not self.stop_evt.is_set():
            # Drain input quickly
            try:
                msg = self.rx_queue.get(timeout=0.01)
                if isinstance(msg, dict):
                    self.handle_msg(msg)
            except Empty:
                pass
            # Tick at telemetry_hz
            now = time.time()
            period = 1.0 / max(0.2, float(self.telemetry_hz or 5.0))
            if now - self._last_tick >= period:
                dt = now - self._last_tick
                self._last_tick = now
                self._tick(dt)

    def close(self):
        try:
            self.stop_evt.set()
            if self.reader.is_alive():
                self.reader.join(timeout=0.5)
        except Exception:
            pass
        try:
            self.ser.close()
        except Exception:
            pass
