"""
World/grid logic: mines, goal, and drone movement.
"""
from typing import Callable, Dict, Optional, Set, Tuple, Any

from models import Config, Drone
from events import emit


class World:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.mines: Set[Tuple[int, int]] = set()
        self.goal: Optional[Tuple[int, int]] = None
        self.drone = Drone(0, 0)
        # Optional scan hook set by App: Callable[[World, int, int], Dict]
        # The App is responsible for emitting `drone_scan` events after scans complete.
        self.scan_func: Optional[Callable[["World", int, int], Dict]] = None

    def in_bounds(self, x_cm: int, y_cm: int) -> bool:
        return 0 <= x_cm < self.cfg.width_cm and 0 <= y_cm < self.cfg.height_cm

    def toggle_mine(self, x_cm: int, y_cm: int):
        if not self.in_bounds(x_cm, y_cm):
            return
        key = (x_cm, y_cm)
        if key in self.mines:
            self.mines.remove(key)
            emit("cell_mine_unset", {
                "x_cm": x_cm, "y_cm": y_cm,
                "x_m": x_cm * self.cfg.metres_per_cm,
                "y_m": y_cm * self.cfg.metres_per_cm,
            })
        else:
            self.mines.add(key)
            emit("cell_mine_set", {
                "x_cm": x_cm, "y_cm": y_cm,
                "x_m": x_cm * self.cfg.metres_per_cm,
                "y_m": y_cm * self.cfg.metres_per_cm,
            })

    def set_goal(self, x_cm: int, y_cm: int):
        if not self.in_bounds(x_cm, y_cm):
            return
        self.goal = (x_cm, y_cm)
        emit("goal_set", {
            "x_cm": x_cm, "y_cm": y_cm,
            "x_m": x_cm * self.cfg.metres_per_cm,
            "y_m": y_cm * self.cfg.metres_per_cm,
        })

    def move_drone(self, dx: int, dy: int):
        from_pos = (self.drone.x_cm, self.drone.y_cm)
        nx = max(0, min(self.cfg.width_cm - 1, self.drone.x_cm + dx))
        ny = max(0, min(self.cfg.height_cm - 1, self.drone.y_cm + dy))
        if (nx, ny) != (self.drone.x_cm, self.drone.y_cm):
            self.drone.x_cm, self.drone.y_cm = nx, ny
            emit("drone_move", {
                "from": {
                    "x_cm": from_pos[0], "y_cm": from_pos[1],
                    "x_m": from_pos[0] * self.cfg.metres_per_cm,
                    "y_m": from_pos[1] * self.cfg.metres_per_cm,
                },
                "to": {
                    "x_cm": nx, "y_cm": ny,
                    "x_m": nx * self.cfg.metres_per_cm,
                    "y_m": ny * self.cfg.metres_per_cm,
                }
            })
            # Invoke scanning via App-provided hook (non-blocking; App will emit drone_scan)
            if self.scan_func is not None:
                try:
                    self.scan_func(self, nx, ny)
                except Exception:
                    pass
