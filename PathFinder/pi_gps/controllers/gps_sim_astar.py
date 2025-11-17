"""
GPS Simulation Controller with A* Pathfinding

Handles:
- Receiving simulated mine positions from Electron app
- Calculating safe paths using A* algorithm
- Simulating drone movement along the path
- Emitting telemetry and mine detections
"""

from __future__ import annotations
import time
import math
from typing import Any, Dict, List, Optional, Tuple

from pathfinder import Pathfinder, PathfinderConfig
from .gps_base import GPSBaseController, GPS, Point


class GPSSimWithPathfinding(GPSBaseController):
    """
    GPS Simulation controller with A* pathfinding for mine avoidance.
    
    Capabilities:
    - Receives simulated mines from UI
    - Generates safe paths using A* algorithm
    - Simulates drone flight along calculated waypoints
    - Emits telemetry and collision warnings
    """
    
    CAPS = ["gps_astar", "telemetry", "simulation", "pathfinding"]
    
    def __init__(self, emit_cb):
        super().__init__(emit_cb)
        self.pathfinder: Optional[Pathfinder] = None
        self.simulated_mines: List[Point] = []
        self.simulated_mines_gps: List[GPS] = []  # Store GPS coords for detection
        self.detected_mines: set = set()  # Track which mines we've already detected
        self.scan_area_width_m: float = 20.0  # Default camera scan width
        self.detection_range_m: float = 2.0  # Realistic overhead imaging range
        
    def display_name(self) -> str:
        return "GPS Sim (A* Pathfinding)"
    
    def settings_schema(self):
        return [
            {"key": "flight_height", "label": "Flight Height (m)", "type": "text", "placeholder": "50"},
            {"key": "camera_angle", "label": "Camera Angle (°)", "type": "text", "placeholder": "45"},
            {"key": "path_width", "label": "Path Width (m)", "type": "text", "placeholder": "5"},
            {"key": "mine_radius", "label": "Mine Circumvention Radius (m)", "type": "text", "placeholder": "10"},
            {"key": "grid_resolution", "label": "Grid Resolution (m)", "type": "text", "placeholder": "0.5"},
        ]
    
    def apply_settings(self, settings: Dict[str, Any]) -> None:
        """Apply pathfinding configuration from UI"""
        try:
            flight_height = float(settings.get("flight_height", 50.0))
            camera_angle = float(settings.get("camera_angle", 45.0))
            path_width = float(settings.get("path_width", 5.0))
            mine_radius = float(settings.get("mine_radius", 10.0))
            grid_resolution = float(settings.get("grid_resolution", 0.5))
            
            config = PathfinderConfig(
                flight_height_m=flight_height,
                camera_angle_deg=camera_angle,
                path_width_m=path_width,
                mine_circumvention_radius_m=mine_radius,
                grid_resolution_m=grid_resolution,
            )
            
            self.pathfinder = Pathfinder(config)
            self.scan_area_width_m = config.scannable_width_m
            
            self.emit({
                "type": "status",
                "message": f"Pathfinder configured: scan_width={self.scan_area_width_m:.1f}m"
            })
        except Exception as e:
            self.emit({"type": "error", "message": f"Settings error: {e}"})
    
    def on_settings_applied(self) -> None:
        """Called after apply_settings"""
        pass
    
    def configure(
        self,
        origin_gps: Optional[GPS],
        metres_per_cm: float,
        simulate: bool,
        simulated_speed_ms: Optional[float],
        mine_buffer_m: float,
        telemetry_hz: float,
    ):
        """Configure the controller with mission parameters"""
        super().configure(
            origin_gps,
            metres_per_cm,
            simulate,
            simulated_speed_ms,
            mine_buffer_m,
            telemetry_hz,
        )
        
        self.emit({"type": "status", "message": "GPSSimWithPathfinding.configure() called"})
        
        # Store mine buffer for pathfinding
        self.mine_buffer_m = mine_buffer_m
        
        # ALWAYS recreate pathfinder with current buffer settings
        # (user may have changed mine_buffer in UI)
        # mine_buffer_m controls BOTH visual mine size AND pathfinding safe distance
        # Set this value in UI to control how far drone stays from mines
        config = PathfinderConfig(
            mine_circumvention_radius_m=mine_buffer_m * 0.75,  # 75% for circumvention
            path_width_m=mine_buffer_m * 0.25,  # 25% for path width
        )
        self.pathfinder = Pathfinder(config)
        self.emit({"type": "status", "message": f"Pathfinder: {mine_buffer_m}m buffer ({config.mine_circumvention_radius_m:.1f}m circumvent + {config.path_width_m:.1f}m path)"})
        
        # Re-initialize grid to ensure it's big enough and centered properly
        # Use 1000m x 1000m grid centered at origin
        if self.projector:
            self.pathfinder.initialize_grid(1000.0, 1000.0)
            self.pathfinder.grid_offset_x = -500.0  # Center grid at origin
            self.pathfinder.grid_offset_y = -500.0
            self.emit({"type": "status", "message": "Pathfinder grid initialized (1000m x 1000m, centered)"})
    
    def set_sim_mines(self, mines_gps: List[GPS]) -> None:
        """
        Receive simulated mine positions from Electron app.
        
        Args:
            mines_gps: List of {lat, lon, radius_m} coordinates
        """
        self.emit({"type": "status", "message": f"set_sim_mines() called with {len(mines_gps)} mines"})
        
        if not self.projector:
            self.emit({"type": "error", "message": "Projector not initialized - mines stored for later"})
            # Store for when projector is ready
            self.simulated_mines_gps = mines_gps
            return
        
        self.simulated_mines.clear()
        self.simulated_mines_gps = mines_gps
        self.detected_mines.clear()
        
        # Store mine positions so we can detect them during flight
        # BUT DON'T add to pathfinder yet - only add when detected!
        for mine in mines_gps:
            xy = self.projector.gps_to_xy(mine)
            radius = float(mine.get('radius_m', self.mine_buffer_m))
            self.simulated_mines.append(xy)
            # DON'T add to obstacles yet - collision avoidance happens via detection
        
        self.emit({
            "type": "status",
            "message": f"✓ Stored {len(self.simulated_mines)} mine positions for detection (pathfinder grid is EMPTY - reactive navigation)"
        })
    
    def start_navigation(self, start_gps: GPS, goal_gps: GPS):
        """
        Start navigation with REACTIVE pathfinding.
        
        NO UPFRONT PLANNING - just fly toward goal!
        When mines detected, replan dynamically.
        """
        self.emit({"type": "status", "message": f"start_navigation() called with start={start_gps}, goal={goal_gps}"})
        
        if not self.projector:
            # Auto-initialize projector with start point
            from .gps_base import GPSProjector
            self.projector = GPSProjector(start_gps)
            self.emit({"type": "status", "message": f"Initialized projector with origin={start_gps}"})
        
        try:
            # Convert to local coordinates
            start_xy = self.projector.gps_to_xy(start_gps)
            goal_xy = self.projector.gps_to_xy(goal_gps)
            
            self.emit({
                "type": "status",
                "message": f"Flying to goal: start_xy={start_xy}, goal_xy={goal_xy}"
            })
            
            # NO A* PATHFINDING HERE!
            # Just create a straight line path - will replan when mines detected
            path_xy = self.pathfinder.draw_straight_line_path(start_xy, goal_xy) if self.pathfinder else [(start_xy[0], start_xy[1]), (goal_xy[0], goal_xy[1])]
            
            self.emit({
                "type": "status",
                "message": "Starting with direct path - will avoid mines dynamically when detected"
            })
            
            self.emit({"type": "status", "message": f"Path computed: {len(path_xy)} waypoints"})
            
            # Store path and initialize navigation state
            self.start_xy = start_xy
            self.goal_xy = goal_xy
            self.pos_xy = start_xy
            self.path_xy = path_xy
            self.path_travelled_xy = [start_xy]
            self.active = True
            
            # Convert path back to GPS for UI
            path_gps = [self.projector.xy_to_gps(pt) for pt in path_xy]
            
            # Calculate total distance
            total_dist = sum(
                math.sqrt((path_xy[i+1][0] - path_xy[i][0])**2 + 
                         (path_xy[i+1][1] - path_xy[i][1])**2)
                for i in range(len(path_xy) - 1)
            )
            
            self.emit({"type": "status", "message": f"Sending path_update with {len(path_gps)} GPS waypoints"})
            
            # Send path to UI (this draws the cyan line)
            self.emit({
                "type": "path_update",
                "waypoints_gps": path_gps,
                "reason": "pathfinding",
                "total_distance_m": total_dist,
                "num_waypoints": len(path_xy)
            })
            
            self.emit({
                "type": "status",
                "message": f"✓ Navigation started: {len(path_xy)} waypoints, {total_dist:.1f}m total distance"
            })
            
            # Send initial telemetry
            self._telemetry()
            
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            self.emit({"type": "error", "message": f"Pathfinding error: {e}"})
            self.emit({"type": "error", "message": f"Traceback: {tb}"})
            self.active = False
    
    def start_mission(self, start_gps: GPS, goal_gps: GPS):
        """Compatibility wrapper that calls start_navigation"""
        self.start_navigation(start_gps, goal_gps)
    
    def tick(self, dt: float):
        """
        Override tick to add mine detection during flight.
        Calls parent tick for movement, then checks for mine detections.
        """
        if not self.active or not self.pos_xy or not self.projector:
            return
        
        # Call parent tick to handle movement
        super().tick(dt)
        
        # Check for mine detections based on current position
        self._check_mine_detections()
    
    def _check_mine_detections(self):
        """
        Check if any mines are within detection range and emit detection messages.
        When a mine is detected, ADD IT TO PATHFINDER and trigger replanning.
        """
        if not self.pos_xy or not self.projector:
            return
        
        curr_x, curr_y = self.pos_xy
        new_mine_detected = False
        
        for i, (mine_xy, mine_gps) in enumerate(zip(self.simulated_mines, self.simulated_mines_gps)):
            mine_id = f"sim_{i}"
            
            # Skip if already detected
            if mine_id in self.detected_mines:
                continue
            
            mine_x, mine_y = mine_xy
            dist = math.sqrt((curr_x - mine_x)**2 + (curr_y - mine_y)**2)
            
            # Detect if within range
            if dist <= self.detection_range_m:
                self.detected_mines.add(mine_id)
                new_mine_detected = True
                
                # ADD MINE TO PATHFINDER NOW (not before!)
                if self.pathfinder:
                    self.pathfinder.add_mine(mine_x, mine_y)
                    self.emit({
                        "type": "status",
                        "message": f"💣 MINE DETECTED at distance {dist:.1f}m - ADDED to pathfinder obstacle map"
                    })
                
                # Emit mine detection
                self.emit({
                    "type": "mine_detected",
                    "at_gps": mine_gps,
                    "distance_m": round(dist, 2),
                    "mine_id": mine_id,
                    "confidence": 0.95,
                })
        
        # Trigger dynamic replanning if new mine detected
        if new_mine_detected and self.active and self.goal_xy:
            self.emit({"type": "status", "message": "🔄 New mine detected - BACKING UP and replanning..."})
            self._back_up_from_danger()
            self._replan_path()
    
    def _back_up_from_danger(self):
        """
        Back up the drone to get outside all mine danger zones.
        Moves backward along the path we came from until safe.
        """
        if not self.pos_xy or not self.path_travelled_xy or not self.pathfinder:
            return
        
        curr_x, curr_y = self.pos_xy
        safe_distance = self.pathfinder.config.min_safe_distance_m
        
        # Check if we're currently in danger
        in_danger = False
        for mine_xy, _ in zip(self.simulated_mines, self.simulated_mines_gps):
            mine_x, mine_y = mine_xy
            dist = math.sqrt((curr_x - mine_x)**2 + (curr_y - mine_y)**2)
            if dist < safe_distance:
                in_danger = True
                break
        
        if not in_danger:
            self.emit({"type": "status", "message": "✓ Current position is safe - no backup needed"})
            return
        
        # Walk backwards through travel path to find safe position
        for i in range(len(self.path_travelled_xy) - 2, -1, -1):
            test_x, test_y = self.path_travelled_xy[i]
            
            # Check if this position is safe from all mines
            is_safe = True
            for mine_xy, _ in zip(self.simulated_mines, self.simulated_mines_gps):
                mine_x, mine_y = mine_xy
                dist = math.sqrt((test_x - mine_x)**2 + (test_y - mine_y)**2)
                if dist < safe_distance:
                    is_safe = False
                    break
            
            if is_safe:
                # Found safe position - move here
                backup_dist = math.sqrt((curr_x - test_x)**2 + (curr_y - test_y)**2)
                self.pos_xy = (test_x, test_y)
                self.emit({
                    "type": "status",
                    "message": f"⬅️ Backed up {backup_dist:.1f}m to safe position"
                })
                return
        
        # If we get here, even start isn't safe - back up in opposite direction of goal
        dx = self.goal_xy[0] - curr_x
        dy = self.goal_xy[1] - curr_y
        dist = math.sqrt(dx*dx + dy*dy)
        if dist > 0:
            # Move safe_distance meters away from goal direction
            backup_x = curr_x - (dx/dist) * safe_distance * 1.5
            backup_y = curr_y - (dy/dist) * safe_distance * 1.5
            self.pos_xy = (backup_x, backup_y)
            self.emit({
                "type": "status",
                "message": f"⬅️ Emergency backup {safe_distance*1.5:.1f}m from danger"
            })
    
    def _replan_path(self):
        """
        Replan path from current position to goal, avoiding newly detected mines.
        """
        if not self.pathfinder or not self.projector or not self.pos_xy or not self.goal_xy:
            return
        
        try:
            # DEBUG: Show current state
            num_mines = len(self.detected_mines)
            self.emit({
                "type": "status",
                "message": f"🔍 Replanning: {num_mines} mines detected, from ({self.pos_xy[0]:.1f}, {self.pos_xy[1]:.1f}) to ({self.goal_xy[0]:.1f}, {self.goal_xy[1]:.1f})"
            })
            
            # Find new path from current position
            new_path_xy = self.pathfinder.find_path(self.pos_xy, self.goal_xy)
            
            if not new_path_xy or len(new_path_xy) < 2:
                # A* failed - try reducing buffer temporarily to find ANY path
                self.emit({
                    "type": "status",
                    "message": f"⚠️ A* failed with {num_mines} obstacles - trying reduced buffer..."
                })
                
                # Save original config
                original_circumvent = self.pathfinder.config.mine_circumvention_radius_m
                original_path = self.pathfinder.config.path_width_m
                
                # Try with 50% reduced buffer
                self.pathfinder.config.mine_circumvention_radius_m *= 0.5
                self.pathfinder.config.path_width_m *= 0.5
                
                # Rebuild obstacle grid with reduced buffer
                temp_mines = list(self.detected_mines)
                self.pathfinder.mines.clear()
                self.pathfinder.grid = [[False] * self.pathfinder.height_cells for _ in range(self.pathfinder.width_cells)]
                for mine_id in temp_mines:
                    mine_gps = self.sim_mines_gps.get(mine_id)
                    if mine_gps:
                        mx, my = self.projector.gps_to_xy(mine_gps)
                        self.pathfinder.add_mine(mx, my)
                
                # Try A* again with reduced buffer
                new_path_xy = self.pathfinder.find_path(self.pos_xy, self.goal_xy)
                
                # Restore original config
                self.pathfinder.config.mine_circumvention_radius_m = original_circumvent
                self.pathfinder.config.path_width_m = original_path
                
                if not new_path_xy or len(new_path_xy) < 2:
                    self.emit({
                        "type": "status",
                        "message": f"❌ CRITICAL: No path found even with reduced buffer - STOPPING"
                    })
                    self.active = False
                    return
                
                self.emit({
                    "type": "status",
                    "message": f"✓ Found path with reduced buffer ({len(new_path_xy)} waypoints)"
                })
            
            # Update path
            self.path_xy = new_path_xy
            
            # Convert to GPS for UI
            path_gps = [self.projector.xy_to_gps(pt) for pt in new_path_xy]
            
            # Calculate total distance
            total_dist = sum(
                math.sqrt((new_path_xy[i+1][0] - new_path_xy[i][0])**2 + 
                         (new_path_xy[i+1][1] - new_path_xy[i][1])**2)
                for i in range(len(new_path_xy) - 1)
            )
            
            # Send updated path to UI (draws cyan detour line)
            self.emit({
                "type": "path_update",
                "waypoints_gps": path_gps,
                "reason": "mine_avoidance",
                "total_distance_m": total_dist,
                "num_waypoints": len(new_path_xy)
            })
            
            self.emit({
                "type": "status",
                "message": f"✅ REPLAN SUCCESS: {len(new_path_xy)} waypoints, {total_dist:.1f}m (avoiding {num_mines} mines)"
            })
            
        except Exception as e:
            import traceback
            self.emit({"type": "error", "message": f"Replan failed: {e}\n{traceback.format_exc()}"})
