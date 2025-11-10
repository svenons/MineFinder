from __future__ import annotations
from typing import Any, Dict, List
from .gps_base import GPSBaseController, GPS


class GPSSimController(GPSBaseController):
    """
    GPS simulation controller
    - Straight-line-first planning in real coordinates
    - Avoids simulated mines provided by client via `sim_mines`
    - Emits telemetry at configured rate with a simple kinematic model
    """
    CAPS = ["gps_astar", "telemetry", "simulation"]

    def __init__(self, emit_cb):
        super().__init__(emit_cb)

    # In simulation, set_sim_mines from base is sufficient.
    # No additional overrides required for now.

    def ingest_event(self, msg: Dict[str, Any]):
        # Simulation can ignore mine_detected since obstacles are provided up-front
        pass
