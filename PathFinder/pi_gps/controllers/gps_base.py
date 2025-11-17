from __future__ import annotations
import math
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

GPS = Dict[str, float]  # {lat, lon, alt?}
Point = Tuple[float, float]  # meters in local frame (x_east, y_north)


def wrap_to_180(lon: float) -> float:
    x = ((lon + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
    return x


class GPSProjector:
    def __init__(self, origin: GPS):
        self.lat0 = float(origin.get("lat") or origin.get("latitude"))
        self.lon0 = float(origin.get("lon") or origin.get("longitude"))
        self._lat0_rad = math.radians(self.lat0)
        self._m_per_deg_lat = 111320.0
        self._m_per_deg_lon = 111320.0 * math.cos(self._lat0_rad)

    def gps_to_xy(self, gps: GPS) -> Point:
        dlat = float(gps.get("lat") or gps.get("latitude")) - self.lat0
        dlon = wrap_to_180(float(gps.get("lon") or gps.get("longitude")) - self.lon0)
        x = dlon * self._m_per_deg_lon
        y = dlat * self._m_per_deg_lat
        return (x, y)

    def xy_to_gps(self, pt: Point) -> GPS:
        x, y = pt
        lat = self.lat0 + (y / self._m_per_deg_lat)
        lon = wrap_to_180(self.lon0 + (x / self._m_per_deg_lon))
        return {"lat": lat, "lon": lon}


def segment_intersects_circle(p1: Point, p2: Point, c: Point, r: float) -> bool:
    # Check if segment (p1->p2) intersects circle centered at c with radius r
    (x1, y1), (x2, y2) = p1, p2
    (cx, cy) = c
    dx = x2 - x1
    dy = y2 - y1
    fx = x1 - cx
    fy = y1 - cy
    a = dx * dx + dy * dy
    b = 2 * (fx * dx + fy * dy)
    cterm = fx * fx + fy * fy - r * r
    # Solve quadratic a*t^2 + b*t + c = 0 for t in [0,1]
    disc = b * b - 4 * a * cterm
    if disc < 0:
        return False
    disc = math.sqrt(disc)
    t1 = (-b - disc) / (2 * a)
    t2 = (-b + disc) / (2 * a)
    return (0.0 <= t1 <= 1.0) or (0.0 <= t2 <= 1.0)


def normalize(vx: float, vy: float) -> Tuple[float, float]:
    n = math.hypot(vx, vy)
    if n <= 1e-9:
        return (0.0, 0.0)
    return (vx / n, vy / n)


def perpendicular(vx: float, vy: float) -> Tuple[float, float]:
    return (-vy, vx)


class GPSBaseController:
    CAPS = ["gps_astar", "telemetry"]

    def __init__(self, emit_cb):
        self.emit = emit_cb
        self.projector: Optional[GPSProjector] = None
        self.metres_per_cm: float = 0.01
        self.simulate: bool = False
        self.simulated_speed_ms: float = 1.5
        self.mine_buffer_m: float = 10.0
        self.telemetry_hz: float = 5.0
        # Obstacles: list of (center_xy, radius_m)
        self.obstacles: List[Tuple[Point, float]] = []
        # Mission state
        self.active: bool = False
        self.start_xy: Optional[Point] = None
        self.goal_xy: Optional[Point] = None
        self.path_xy: List[Point] = []
        self.path_travelled_xy: List[Point] = []
        self.pos_xy: Optional[Point] = None
        self._last_tick_ts: float = time.time()
        # Telemetry payload control
        self._last_travel_snapshot_ts: float = 0.0
        self._travel_snapshot_period: float = 5.0  # seconds between full snapshots
        self._travel_tail_count: int = 30          # points to include in snapshots

    # ---- API from server ----
    def configure(self, origin_gps: Optional[GPS], metres_per_cm: float, simulate: bool, simulated_speed_ms: Optional[float], mine_buffer_m: float, telemetry_hz: float):
        if origin_gps:
            self.projector = GPSProjector(origin_gps)
        self.metres_per_cm = float(metres_per_cm or 0.01)
        self.simulate = bool(simulate)
        if simulated_speed_ms is not None:
            self.simulated_speed_ms = float(simulated_speed_ms)
        self.mine_buffer_m = float(mine_buffer_m or 10.0)
        self.telemetry_hz = float(telemetry_hz or 5.0)

    def set_sim_mines(self, mines_gps: List[GPS]):
        if not self.projector:
            return
        obs: List[Tuple[Point, float]] = []
        for m in mines_gps or []:
            try:
                radius = float(m.get("radius_m", self.mine_buffer_m))
                pt = self.projector.gps_to_xy(m)
                obs.append((pt, radius))
            except Exception:
                continue
        self.obstacles = obs

    def start_mission(self, start_gps: GPS, goal_gps: GPS):
        if not self.projector:
            # If origin not configured yet, set it to start
            self.projector = GPSProjector(start_gps)
        self.start_xy = self.projector.gps_to_xy(start_gps)
        self.goal_xy = self.projector.gps_to_xy(goal_gps)
        self.pos_xy = self.start_xy
        self.path_xy = self.plan_path(self.start_xy, self.goal_xy)
        self.path_travelled_xy = [self.start_xy]
        self.active = True
        # Emit initial path update
        self.emit({
            "type": "path_update",
            "waypoints_gps": [self.projector.xy_to_gps(p) for p in self.path_xy],
            "reason": "initial",
        })

    def stop_mission(self):
        self.active = False
        self.emit({"type": "nav_done"})

    def ingest_event(self, msg: Dict[str, Any]):
        # Extend in child classes if needed (e.g., mine_detected)
        pass

    # ---- Planning ----
    def plan_path(self, start_xy: Point, goal_xy: Point) -> List[Point]:
        # Straight-line first; detour around any single circle intersecting
        if not self.obstacles:
            return [start_xy, goal_xy]
        if not self._segment_blocked(start_xy, goal_xy):
            return [start_xy, goal_xy]
        # Try single-detour via left/right offsets around the nearest obstacle
        nearest = self._nearest_intersecting_obstacle(start_xy, goal_xy)
        if nearest is None:
            return [start_xy, goal_xy]
        (c, r) = nearest
        path = self._detour_single(start_xy, goal_xy, c, r)
        if path:
            return path
        # Fallback: very coarse dogleg via perpendicular offsets.
        return [start_xy, self._dogleg_waypoint(start_xy, goal_xy, c, r, side=1.0), goal_xy]

    def _segment_blocked(self, a: Point, b: Point) -> bool:
        for (c, r) in self.obstacles:
            if segment_intersects_circle(a, b, c, r):
                return True
        return False

    def _nearest_intersecting_obstacle(self, a: Point, b: Point) -> Optional[Tuple[Point, float]]:
        best = None
        best_d = 1e18
        for (c, r) in self.obstacles:
            if segment_intersects_circle(a, b, c, r):
                # distance from a to c
                d = math.hypot(c[0] - a[0], c[1] - a[1])
                if d < best_d:
                    best = (c, r)
                    best_d = d
        return best

    def _dogleg_waypoint(self, a: Point, b: Point, c: Point, r: float, side: float) -> Point:
        # Compute waypoint at circle edge offset perpendicular to line a->b
        ax, ay = a
        bx, by = b
        dx, dy = normalize(bx - ax, by - ay)
        px, py = perpendicular(dx, dy)
        # Push away from circle center side
        wx = c[0] + px * (r + self.mine_buffer_m * 0.5) * side
        wy = c[1] + py * (r + self.mine_buffer_m * 0.5) * side
        return (wx, wy)

    def _detour_single(self, a: Point, b: Point, c: Point, r: float) -> Optional[List[Point]]:
        # Try left/right dogleg and pick the shorter that avoids all obstacles
        w_left = self._dogleg_waypoint(a, b, c, r, side=1.0)
        w_right = self._dogleg_waypoint(a, b, c, r, side=-1.0)
        candidates = []
        for w in (w_left, w_right):
            if not self._segment_blocked(a, w) and not self._segment_blocked(w, b):
                candidates.append([a, w, b])
        if not candidates:
            return None
        # Choose shortest path
        def plen(path: List[Point]) -> float:
            d = 0.0
            for i in range(1, len(path)):
                d += math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1])
            return d
        candidates.sort(key=plen)
        return candidates[0]

    # ---- Motion & Telemetry ----
    def tick(self, dt: float):
        if not self.active or not self.path_xy or self.pos_xy is None or not self.projector:
            return
        speed = max(0.0, float(self.simulated_speed_ms or 0.0))
        if speed <= 0.0:
            speed = 0.1
        # Advance along path
        pos = list(self.pos_xy)
        i_next = 1
        # Ensure we have at least two points
        if len(self.path_xy) < 2:
            self._finish()
            return
        # Find the current segment towards the next waypoint
        target = self.path_xy[i_next]
        vx = target[0] - pos[0]
        vy = target[1] - pos[1]
        dist = math.hypot(vx, vy)
        if dist < 0.05:
            # Arrived at waypoint; if this was the last, finish
            self.path_xy.pop(0)
            if len(self.path_xy) < 2:
                self.pos_xy = tuple(target)
                self.path_travelled_xy.append(self.pos_xy)
                self._telemetry()
                self._finish()
                return
            target = self.path_xy[1]
            vx = target[0] - pos[0]
            vy = target[1] - pos[1]
            dist = math.hypot(vx, vy)
        # Move by step
        ux, uy = normalize(vx, vy)
        step = speed * dt
        if step >= dist:
            pos[0], pos[1] = target[0], target[1]
            # Trim the first point (we reached it)
            self.path_xy[0] = tuple(target)
        else:
            pos[0] += ux * step
            pos[1] += uy * step
        self.pos_xy = (pos[0], pos[1])
        self.path_travelled_xy.append(self.pos_xy)
        # Emit telemetry periodically (server controls tick rate)
        self._telemetry()

    def _telemetry(self):
        proj = self.projector
        if not proj:
            return
        # Position (rounded to 6 decimals to reduce payload ~11 cm at equator)
        pos_gps_raw = proj.xy_to_gps(self.pos_xy)
        pos_gps = {"lat": round(float(pos_gps_raw["lat"]), 6), "lon": round(float(pos_gps_raw["lon"]), 6)}
        # Send FULL travelled path to show complete trail with backtracks
        travelled = [{"lat": round(float(g["lat"]), 6), "lon": round(float(g["lon"]), 6)} for g in (proj.xy_to_gps(p) for p in self.path_travelled_xy)]
        # Do not include path_active_gps on every tick (it is sent via path_update)
        self.emit({
            "type": "telemetry",
            "pos_gps": pos_gps,
            "path_travelled_gps": travelled,
            "speed_ms": self.simulated_speed_ms,
            "ts": time.time(),
        })

    def _finish(self):
        self.active = False
        self.emit({"type": "nav_done"})
