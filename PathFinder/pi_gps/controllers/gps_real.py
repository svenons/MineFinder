from __future__ import annotations
from typing import Any, Dict
from .gps_base import GPSBaseController


class GPSRealController(GPSBaseController):
    """
    GPS real controller (skeleton)
    - Straight-line-first planning in real coordinates
    - Obstacles can be reported dynamically via mine_detected (at_gps)
    """
    CAPS = ["gps_astar", "telemetry"]

    def __init__(self, emit_cb):
        super().__init__(emit_cb)

    def ingest_event(self, msg: Dict[str, Any]):
        # Expect { type: 'mine_detected', at_gps: { lat, lon } }
        t = msg.get("type")
        if t == "mine_detected":
            at = msg.get("at_gps")
            if not at or not self.projector:
                return
            try:
                c = self.projector.gps_to_xy(at)
                # Add with default buffer
                self.obstacles.append((c, float(self.mine_buffer_m)))
                # Re-plan from current position to goal
                if self.pos_xy is not None and self.goal_xy is not None:
                    self.path_xy = self.plan_path(self.pos_xy, self.goal_xy)
                    # Emit path update
                    self.emit({
                        "type": "path_update",
                        "waypoints_gps": [self.projector.xy_to_gps(p) for p in self.path_xy],
                        "reason": "replan",
                    })
            except Exception:
                return
