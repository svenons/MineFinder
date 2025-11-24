#!/usr/bin/env python3
"""
Serial Navigation Server for Raspberry Pi (standalone)

Speaks a simple JSON Lines protocol over a serial link to the Pygame client.
This process runs on the Raspberry Pi. It performs all navigation logic:
- Receives board dimensions, start, goal
- Computes path using A*
- For each step: requests a scan from the client and waits for the result
- On safe, sends a move command to the client
- On mine detection (from scan_result or async mine message), updates map and re-plans
- Finishes with nav_done when goal is reached

Defaults: port=/dev/serial0, baud=9600. Override via CLI args or env.

Usage on Pi:
    python3 pi/serial_nav_server.py --port /dev/serial0 --baud 9600

Protocol (JSONL):
Client → Server:
  {"type":"hello","role":"client","version":1}
  {"type":"nav_start","board":{"width":W,"height":H,"metres_per_cm":M,"mines":[[x,y],...]},"start":[sx,sy],"goal":[gx,gy]}
  {"type":"nav_stop"}
  {"type":"mine","at":[x,y]}
  {"type":"scan_result","at":[x,y],"mine":bool}

Server → Client:
  {"type":"path","path":[[x,y], ...]}
  {"type":"move","to":[x,y]}
  {"type":"request_scan","at":[x,y]}
  {"type":"nav_done"}
  {"type":"toast","message":"...","duration":1.5}
  {"type":"status", ... }

Notes:
- Requires: pip install pyserial
- Ensure UART is enabled on the Pi and your user has access to the serial device (e.g., add to dialout group).
"""

from __future__ import annotations

import json
import os
import sys
import time
import threading
from queue import Queue, Empty
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Set
import argparse
import heapq

try:
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None  # type: ignore


# ----------------- Data structures -----------------
@dataclass
class Board:
    min_x: int
    max_x: int
    min_y: int
    max_y: int
    metres_per_cm: float = 1.0
    mines: Set[Tuple[int, int]] = field(default_factory=set)

    def in_bounds(self, x: int, y: int) -> bool:
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y


# ----------------- Server -----------------
class SerialNavServer:
    def __init__(self, port: str, baud: int, scan_timeout: float = 60.0, simulate_scanner: bool = True):
        if serial is None:
            raise RuntimeError("pyserial not available on this system. Run: pip install pyserial")
        self.port = port
        self.baud = baud
        self.scan_timeout = float(scan_timeout)
        self.simulate_scanner = bool(simulate_scanner)
        self.ser = serial.Serial(self.port, self.baud, timeout=0.2, write_timeout=0.5)
        self.rx_queue: Queue = Queue()
        self.stop_evt = threading.Event()
        self.reader = threading.Thread(target=self._reader_loop, daemon=True)
        self.reader.start()

        # Navigation/session state
        self.board: Optional[Board] = None
        self.goal: Optional[Tuple[int, int]] = None
        self.current: Optional[Tuple[int, int]] = None
        self.known_mines: Set[Tuple[int, int]] = set()
        self.hidden_mines: Set[Tuple[int, int]] = set()  # Optional ground-truth for simulation (not used for planning)
        self.pending_nav_stop = False

    # --------------- I/O ---------------
    def _send(self, obj: dict) -> None:
        try:
            line = json.dumps(obj) + "\n"
            self.ser.write(line.encode("utf-8"))
        except Exception as e:
            print(f"[SerialNavServer] write error: {e}", file=sys.stderr)

    def _reader_loop(self):
        while not self.stop_evt.is_set():
            try:
                chunk = self.ser.readline()
                if not chunk:
                    continue
                try:
                    msg = json.loads(chunk.decode("utf-8", errors="ignore").strip())
                except Exception:
                    continue
                if isinstance(msg, dict):
                    self.rx_queue.put(msg)
            except Exception:
                time.sleep(0.05)

    # --------------- Planning ---------------
    def _neighbors(self, p: Tuple[int, int]) -> List[Tuple[int, int]]:
        x, y = p
        nbs = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        assert self.board is not None
        res: List[Tuple[int, int]] = []
        for nx, ny in nbs:
            if self.board.in_bounds(nx, ny) and (nx, ny) not in self.known_mines:
                res.append((nx, ny))
        return res

    @staticmethod
    def _manhattan(a: Tuple[int, int], b: Tuple[int, int]) -> int:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])

    def _plan(self, start: Tuple[int, int], goal: Tuple[int, int]) -> List[Tuple[int, int]]:
        if self.board is None:
            return []
        open_heap: List[Tuple[int, Tuple[int, int]]] = []
        heapq.heappush(open_heap, (0, start))
        came_from: dict[Tuple[int, int], Tuple[int, int]] = {}
        g: dict[Tuple[int, int], int] = {start: 0}
        f: dict[Tuple[int, int], int] = {start: self._manhattan(start, goal)}
        seen = {start}

        while open_heap:
            _, cur = heapq.heappop(open_heap)
            if cur == goal:
                # Reconstruct
                path = [cur]
                while cur in came_from:
                    cur = came_from[cur]
                    path.append(cur)
                return list(reversed(path))
            for nb in self._neighbors(cur):
                tentative = g[cur] + 1
                if nb not in g or tentative < g[nb]:
                    came_from[nb] = cur
                    g[nb] = tentative
                    f[nb] = tentative + self._manhattan(nb, goal)
                    if nb not in seen:
                        heapq.heappush(open_heap, (f[nb], nb))
                        seen.add(nb)
        return []

    # --------------- Protocol handling ---------------
    def _wait_for(self, predicate, timeout: float) -> Optional[dict]:
        deadline = time.time() + timeout
        while time.time() < deadline and not self.pending_nav_stop:
            try:
                msg = self.rx_queue.get(timeout=0.1)
            except Empty:
                continue
            if not isinstance(msg, dict):
                continue
            # Handle async mine and nav_stop at any time
            t = msg.get("type")
            if t == "mine":
                at = msg.get("at")
                if isinstance(at, (list, tuple)) and len(at) == 2:
                    self._register_mine((int(at[0]), int(at[1])))
                    continue  # keep waiting for the intended message
            elif t == "nav_stop":
                self.pending_nav_stop = True
                return None
            if predicate(msg):
                return msg
        return None

    def _register_mine(self, pos: Tuple[int, int]):
        if pos not in self.known_mines:
            self.known_mines.add(pos)
            self._send({"type": "status", "message": f"Mine registered at {pos[0]},{pos[1]}"})

    def _handle_nav_session(self, start: Tuple[int, int], goal: Tuple[int, int]):
        self.current = start
        # Initial plan
        path = self._plan(start, goal)
        if not path:
            self._send({"type": "toast", "message": "No path found", "duration": 1.8})
            self._send({"type": "nav_done"})
            return
        self._send({"type": "path", "path": [[x, y] for (x, y) in path]})
        # Iterate steps (skip the first, which is current)
        idx = 1
        while not self.pending_nav_stop and idx < len(path):
            step = path[idx]
            sx, sy = step[0], step[1]

            # Simulation mode: server "knows" hidden mines but pretends to only check the current step.
            if self.simulate_scanner:
                if (sx, sy) in self.hidden_mines:
                    # Encountered a mine at the next step → register and re-plan (no move)
                    self._register_mine((sx, sy))
                    self._send({"type": "status", "message": f"Mine at {sx},{sy} → re-planning"})
                    new_path = self._plan(self.current, goal)
                    if not new_path:
                        self._send({"type": "toast", "message": "Path blocked by mines", "duration": 2.0})
                        self._send({"type": "nav_done"})
                        return
                    path = new_path
                    idx = 1
                    self._send({"type": "path", "path": [[x, y] for (x, y) in path]})
                    continue
                else:
                    # Safe → move immediately
                    self.current = (sx, sy)
                    self._send({"type": "move", "to": [sx, sy]})
                    idx += 1
                    continue

            # Non-simulated mode: ask the client to scan this cell before moving
            self._send({"type": "request_scan", "at": [sx, sy]})

            # Wait for a scan_result for this cell, with a (configurable) timeout
            def pred(msg):
                return (
                    msg.get("type") == "scan_result"
                    and isinstance(msg.get("at"), list)
                    and msg.get("at") == [sx, sy]
                )

            reply = self._wait_for(pred, timeout=self.scan_timeout)
            mine_here = False
            if reply is None:
                # timeout or nav_stop; if stopped, break; else assume safe but report
                if self.pending_nav_stop:
                    break
                self._send({"type": "status", "message": f"Scan timeout at {sx},{sy}. Proceeding cautiously."})
            else:
                mine_here = bool(reply.get("mine", False))
            # Also consider any asynchronously reported mines (already registered)
            if (sx, sy) in self.known_mines or mine_here:
                # Record and re-plan from current
                self._register_mine((sx, sy))
                self._send({"type": "status", "message": f"Mine at {sx},{sy} → re-planning"})
                new_path = self._plan(self.current, goal)
                if not new_path:
                    self._send({"type": "toast", "message": "Path blocked by mines", "duration": 2.0})
                    self._send({"type": "nav_done"})
                    return
                path = new_path
                idx = 1
                self._send({"type": "path", "path": [[x, y] for (x, y) in path]})
                continue
            # Safe → move
            self.current = (sx, sy)
            self._send({"type": "move", "to": [sx, sy]})
            # If goal reached (in case goal equals step), continue loop condition will exit next
            idx += 1
        self._send({"type": "nav_done"})

    def serve_forever(self):
        print(f"[SerialNavServer] ready on {self.port}@{self.baud}")
        self._send({"type": "status", "message": f"Server ready on {self.port}@{self.baud}"})
        while not self.stop_evt.is_set():
            try:
                msg = self.rx_queue.get(timeout=0.1)
            except Empty:
                continue
            if not isinstance(msg, dict):
                continue
            t = msg.get("type")
            if t == "hello":
                self._send({"type": "status", "message": "Hello received"})
            elif t == "nav_start":
                # Reset session state
                self.pending_nav_stop = False
                self.known_mines = set()  # Start with zero known mines (do not seed)
                board_obj = msg.get("board") or {}
                mpc = float(board_obj.get("metres_per_cm", 1.0))
                mines: Set[Tuple[int, int]] = set()
                for m in board_obj.get("mines", []) or []:
                    try:
                        if isinstance(m, (list, tuple)) and len(m) == 2:
                            mines.add((int(m[0]), int(m[1])))
                    except Exception:
                        pass
                
                start = msg.get("start") or [0, 0]
                goal = msg.get("goal") or [0, 0]
                
                try:
                    start_t = (int(start[0]), int(start[1]))
                    goal_t = (int(goal[0]), int(goal[1]))
                except Exception:
                    self._send({"type": "toast", "message": "Invalid start/goal", "duration": 1.8})
                    continue

                # Calculate dynamic bounds
                all_x = [start_t[0], goal_t[0]]
                all_y = [start_t[1], goal_t[1]]
                for mx, my in mines:
                    all_x.append(mx)
                    all_y.append(my)
                
                padding = 200  # 2 meters padding
                min_x = min(all_x) - padding
                max_x = max(all_x) + padding
                min_y = min(all_y) - padding
                max_y = max(all_y) + padding

                # Store any provided mines as hidden ground-truth (simulation aid), but DO NOT seed planning
                self.hidden_mines = set(mines)
                self.board = Board(min_x=min_x, max_x=max_x, min_y=min_y, max_y=max_y, metres_per_cm=mpc, mines=mines)
                
                if self.board is None or not self.board.in_bounds(*start_t) or not self.board.in_bounds(*goal_t):
                    self._send({"type": "toast", "message": "Start/goal out of bounds", "duration": 2.0})
                    continue
                # Drive the navigation session; consume additional messages via _wait_for inside
                self._handle_nav_session(start_t, goal_t)
            elif t == "nav_stop":
                self.pending_nav_stop = True
                self._send({"type": "status", "message": "Navigation stopped"})
            elif t == "mine":
                at = msg.get("at")
                if isinstance(at, (list, tuple)) and len(at) == 2:
                    self._register_mine((int(at[0]), int(at[1])))
            elif t == "scan_result":
                # These are primarily consumed by _wait_for; ignore here
                pass
            else:
                self._send({"type": "status", "message": f"Unknown msg: {t}"})

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


# ----------------- CLI -----------------
def parse_args(argv: List[str]):
    parser = argparse.ArgumentParser(description="Serial Navigation Server (Raspberry Pi)")
    parser.add_argument("--port", default=os.environ.get("SERIAL_PORT", "/dev/serial0"), help="Serial port device path")
    parser.add_argument("--baud", type=int, default=int(os.environ.get("SERIAL_BAUD", "9600")), help="Baud rate")
    parser.add_argument("--scan-timeout", type=float, default=float(os.environ.get("SCAN_TIMEOUT", "60")), help="Scan wait timeout (seconds) in non-simulated mode")
    sim_default = os.environ.get("SIMULATE_SCANNER", "1").lower() not in ("0", "false", "no")
    parser.add_argument("--simulate-scanner", dest="simulate_scanner", action="store_true", default=sim_default, help="Simulate scans using hidden ground-truth mines (default: on)")
    parser.add_argument("--no-simulate-scanner", dest="simulate_scanner", action="store_false", help="Disable simulated scanner; use request_scan/scan_result flow")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    print(f"[SerialNavServer] starting on {args.port}@{args.baud} (simulate_scanner={args.simulate_scanner}, scan_timeout={args.scan_timeout}s)")
    if serial is None:
        print("pyserial not installed. pip install pyserial", file=sys.stderr)
        return 2
    try:
        server = SerialNavServer(args.port, args.baud, scan_timeout=args.scan_timeout, simulate_scanner=args.simulate_scanner)
    except Exception as e:
        print(f"[SerialNavServer] failed to open serial: {e}", file=sys.stderr)
        return 2
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[SerialNavServer] interrupted")
    finally:
        server.close()
        print("[SerialNavServer] stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
