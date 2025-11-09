import time
import json
import threading
from queue import Queue, Empty

try:
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None

from controllers.base import DroneController
from events import emit

PORT = "/dev/ttyUSB0"
BAUD = 9600


class SmartController(DroneController):
    """
    A smart controller that autopilots the drone using A* pathfinding.
    Serial Client
    """

    def __init__(self):
        super().__init__()

        self.settings = {
            "port": PORT,
            "baud": BAUD,
            "auto_connect": "1",
        }

        # Serial state
        self._ser = None
        self._rx_queue: Queue = Queue()
        self._reader_thread = None
        self._stop_evt = threading.Event()
        self._connected = False

        self.path = []
        self.navigating = False
        self.move_delay = 0.2  # seconds
        self.last_move_time = 0
        self.original_path = []  # Store the original calculated path
        self.all_path_segments = []  # Store all path segments with colors: [(path, color, is_active)]
        self.path_history = []  # Track all positions the drone has actually traveled
        self.last_safe_position = None  # Track the last safe position before mine detection
        self.pending_mine_detection = False  # Flag to handle mine detection after move
        self.current_segment_index = 0  # Track which segment we're currently on
        self.moving_back = False  # Flag to indicate drone is moving back
        self.mine_position = None  # Store mine position for backtracking
        self.detected_mines = set()  # Mines detected by scanning (to avoid in future paths)
        self.backtrack_path = []  # Path used when retreating from a mine
        self.backtrack_segment_index = None  # Index of the backtrack segment in all_path_segments
        self.backtrack_progress = 0  # Progress along the backtrack path

    def display_name(self) -> str:
        return "Smart Autopilot (Serial Client)"

    # ---- Settings & lifecycle ----
    def settings_schema(self):
        return [
            {"key": "port", "label": "Serial port", "type": "text", "placeholder": self.settings.get("port", PORT)},
            {"key": "baud", "label": "Baud", "type": "text", "placeholder": str(self.settings.get("baud", BAUD))},
            {"key": "auto_connect", "label": "Auto-connect (1/0)", "type": "text", "placeholder": self.settings.get("auto_connect", "1")},
        ]

    def apply_settings(self, settings):
        if not isinstance(settings, dict):
            return
        for k in ("port", "baud", "auto_connect"):
            if k in settings:
                self.settings[k] = settings[k]

    def on_settings_applied(self) -> None:
        # Attempt auto-connect if requested
        if str(self.settings.get("auto_connect", "1")) == "1":
            try:
                self.connect()
            except Exception:
                pass

    def attach(self, app):
        super().attach(app)
        # Auto-connect on attach if enabled
        if str(self.settings.get("auto_connect", "1")) == "1":
            try:
                self.connect()
            except Exception:
                pass

    # ---- Serial connection helpers ----
    def connect(self):
        if self._connected:
            return True
        if serial is None:
            self.app.show_toast("pyserial not available", duration=2.0)
            return False
        port = str(self.settings.get("port", PORT))
        try:
            baud = int(str(self.settings.get("baud", BAUD)))
        except Exception:
            baud = BAUD
        try:
            self._ser = serial.Serial(port, baud, timeout=0.2)
            self._stop_evt.clear()
            self._reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
            self._reader_thread.start()
            self._connected = True
            self.app.show_toast(f"Connected to {port} @ {baud}", duration=1.5)
            emit("serial_connected", {"port": port, "baud": baud})
            # Send a hello so server knows we're here
            self._send({"type": "hello", "role": "client", "version": 1})
            return True
        except Exception as e:
            try:
                self.app.show_toast(f"Serial connect failed: {e}", duration=2.5)
            except Exception:
                pass
            self._connected = False
            self._ser = None
            return False

    def disconnect(self):
        try:
            self._connected = False
            if self._stop_evt:
                self._stop_evt.set()
            if self._reader_thread and self._reader_thread.is_alive():
                self._reader_thread.join(timeout=0.5)
        except Exception:
            pass
        try:
            if self._ser is not None:
                self._ser.close()
        finally:
            self._ser = None
            self.app.show_toast("Serial disconnected", duration=1.0)
            emit("serial_disconnected", {})

    def _send(self, obj):
        try:
            if not self._ser:
                return
            line = json.dumps(obj) + "\n"
            self._ser.write(line.encode("utf-8"))
        except Exception:
            pass

    def _reader_loop(self):
        buf = b""
        while not self._stop_evt.is_set():
            try:
                if not self._ser:
                    break
                chunk = self._ser.readline()
                if not chunk:
                    continue
                try:
                    msg = json.loads(chunk.decode("utf-8", errors="ignore").strip())
                    if isinstance(msg, dict):
                        self._rx_queue.put(msg)
                except Exception:
                    # Ignore malformed lines
                    continue
            except Exception:
                time.sleep(0.1)
                continue

    # ---- Navigation delegated to server ----
    def start_navigation(self):
        """
        Starts the navigation to the goal via the serial server.
        """
        if self.app.world.goal is None:
            self.app.show_toast("Set a goal first!", duration=2.0)
            return
        if not self._connected:
            if not self.connect():
                return

        # Reset local state and wait for server to drive movement/path
        self.navigating = True
        self.path = []
        self.original_path = []
        self.all_path_segments = []
        self.path_history = []
        self.current_segment_index = 0
        self.detected_mines = set()
        self.backtrack_path = []
        self.backtrack_segment_index = None
        self.backtrack_progress = 0
        self.moving_back = False
        self.mine_position = None

        # Send board description and nav start
        world = self.app.world
        payload = {
            "type": "nav_start",
            "board": {
                "width": world.cfg.width_cm,
                "height": world.cfg.height_cm,
                "metres_per_cm": world.cfg.metres_per_cm,
                "mines": list([list(m) for m in world.mines]),
            },
            "start": [world.drone.x_cm, world.drone.y_cm],
            "goal": list(world.goal),
        }
        self._send(payload)
        self.app.show_toast("Requested path from server...", duration=1.5)
        emit("path_requested_remote", {"goal": world.goal})

    def stop_navigation(self):
        """
        Stops the navigation.
        """
        if self._connected:
            self._send({"type": "nav_stop"})
        self.navigating = False
        self.path = []
        self.original_path = []
        self.all_path_segments = []
        self.path_history = []
        self.last_safe_position = None
        self.pending_mine_detection = False
        self.current_segment_index = 0
        self.moving_back = False
        self.mine_position = None
        self.detected_mines = set()
        self.backtrack_path = []
        self.backtrack_segment_index = None
        self.backtrack_progress = 0

    def on_mine_detected(self):
        """
        Called by the App when a mine is detected by the drone.
        Notifies the server and sets a local flag.
        """
        if not self.navigating:
            return
        try:
            pos = (self.app.world.drone.x_cm, self.app.world.drone.y_cm)
            self._send({"type": "mine", "at": [pos[0], pos[1]]})
        except Exception:
            pass
        self.pending_mine_detected = True  # backward compat typo guard
        self.pending_mine_detection = True

    def scan_at(self, world, x_cm: int, y_cm: int):
        """Simulate the drone's sensor sweep at the current cell.

        The drone only learns about mines once it physically visits the
        coordinate. A detection both notifies the app (which marks the grid)
        and lets the controller remember that this cell is unsafe for future
        pathfinding.
        """
        has_mine = (x_cm, y_cm) in world.mines
        if has_mine:
            self.detected_mines.add((x_cm, y_cm))
        return {"mine": has_mine}

    def _build_backtrack_path(self, start, end):
        """Create a simple Manhattan path from the mine back to the last safe tile."""
        if not start or not end:
            return []
        path = [start]
        current = start
        while current != end:
            cx, cy = current
            tx, ty = end
            if cx < tx:
                current = (cx + 1, cy)
            elif cx > tx:
                current = (cx - 1, cy)
            elif cy < ty:
                current = (cx, cy + 1)
            else:
                current = (cx, cy - 1)
            path.append(current)
        return path

    def _handle_msg(self, msg: dict):
        t = msg.get("type")
        if t == "path":
            path = msg.get("path") or []
            # normalize to tuples
            norm = [(int(p[0]), int(p[1])) for p in path if isinstance(p, (list, tuple)) and len(p) == 2]
            self.original_path = list(norm)
            self.path = list(norm)
            self.all_path_segments = []
            if norm:
                self.all_path_segments.append({
                    'path': list(norm),
                    'color': (100, 100, 255),  # Blue for server path
                    'is_active': True
                })
            emit("path_calculated", {"path": norm, "length": len(norm)})
            if norm:
                try:
                    self.app.show_toast(f"Path from server: {len(norm)} steps", duration=1.5)
                except Exception:
                    pass
        elif t == "move":
            to = msg.get("to") or msg.get("pos")
            if isinstance(to, (list, tuple)) and len(to) == 2:
                cx, cy = self.app.world.drone.x_cm, self.app.world.drone.y_cm
                tx, ty = int(to[0]), int(to[1])
                dx, dy = tx - cx, ty - cy
                # Save last safe before moving
                self.last_safe_position = (cx, cy)
                self.app.world.move_drone(dx, dy)
                # Trim path if we have one
                if self.path:
                    while self.path and self.path[0] != (tx, ty):
                        self.path = self.path[1:]
        elif t == "nav_done":
            self.navigating = False
            try:
                self.app.show_toast("Server navigation complete", duration=1.5)
            except Exception:
                pass
        elif t == "toast":
            try:
                self.app.show_toast(str(msg.get("message", "")), duration=float(msg.get("duration", 1.5)))
            except Exception:
                pass
        elif t == "request_scan":
            at = msg.get("at")
            if isinstance(at, (list, tuple)) and len(at) == 2:
                x, y = int(at[0]), int(at[1])
                try:
                    result = self.scan_at(self.app.world, x, y) or {}
                except Exception:
                    result = {"mine": False}
                self._send({"type": "scan_result", "at": [x, y], **result})
        elif t == "status":
            # Optional status message from server; ignore or log
            pass

    def update(self, dt: float):
        """
        In serial client mode, process inbound messages from the server and let the server drive moves.
        """
        # Drain incoming messages quickly
        while True:
            try:
                msg = self._rx_queue.get_nowait()
            except Empty:
                break
            try:
                if isinstance(msg, dict):
                    self._handle_msg(msg)
            except Exception:
                pass
        # Client does not perform any autonomous movement/pathfinding.
        return

    def get_paths_to_draw(self):
        """
        Returns a list of path segments with their colors for rendering.
        Returns: List of tuples (path_list, color_tuple)
        """
        paths = []
        
        # Draw all path segments (they all remain visible)
        for segment in self.all_path_segments:
            if segment['path'] and len(segment['path']) > 0:
                paths.append((segment['path'], segment['color']))
        
        return paths

