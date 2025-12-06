"""Corridor sweep scanning algorithm"""

import math
import logging
from dataclasses import dataclass
from typing import List, Tuple, Optional, Set
from enum import Enum


class SweepState(Enum):
    """States of the scanning process"""
    IDLE = "idle"
    SCANNING = "scanning"
    AVOIDING = "avoiding"
    EXPANDING = "expanding"
    COMPLETE = "complete"


@dataclass
class ScanCell:
    """Individual scan cell in the grid"""
    x_m: float
    y_m: float
    lat: float
    lon: float
    scanned: bool = False
    result: Optional[str] = None  # 'clear' | 'mine'
    confidence: float = 0.0


@dataclass
class CorridorConfig:
    """Configuration for corridor sweep"""
    start: Tuple[float, float]    # (lat, lon)
    goal: Tuple[float, float]     # (lat, lon)
    corridor_width_m: float = 3.0 # Width of scan corridor
    scan_cell_size_m: float = 1.0 # Size of each scan cell (1m²)
    num_lines: int = 3            # Number of parallel scan lines
    altitude_m: float = 10.0      # Flight altitude
    expansion_margin_m: float = 2.0  # How far to expand if mine found


class CorridorSweepAlgorithm:
    """
    Systematic corridor sweep for mine detection.
    
    Strategy:
    1. Generate scan grid covering corridor from A to B
    2. Fly snake pattern (forward, shift, backward, shift, forward...)
    3. At each cell: hover, capture thermal, run detection
    4. If mine found: mark cell, optionally expand scan area
    5. After complete sweep: calculate safe path using A*
    """
    
    def __init__(self, config: CorridorConfig):
        self.config = config
        self.state = SweepState.IDLE
        self.cells: List[ScanCell] = []
        self.current_cell_idx = 0
        self.detected_mines: Set[Tuple[float, float]] = set()
        self.safe_path: List[Tuple[float, float]] = []
        self.log = logging.getLogger(__name__)
        
        self._generate_scan_grid()
    
    def _generate_scan_grid(self):
        """Generate scan cells covering the corridor"""
        start = self.config.start
        goal = self.config.goal
        
        # Calculate corridor direction vector
        dx = goal[1] - start[1]  # lon difference
        dy = goal[0] - start[0]  # lat difference
        length_deg = math.sqrt(dx*dx + dy*dy)
        
        # Approximate conversion (varies by latitude)
        meters_per_deg_lat = 111320
        meters_per_deg_lon = 111320 * math.cos(math.radians(start[0]))
        
        length_m = math.sqrt(
            (dy * meters_per_deg_lat)**2 + 
            (dx * meters_per_deg_lon)**2
        )
        
        # Unit direction vector
        if length_m > 0:
            dir_x = dx / length_deg
            dir_y = dy / length_deg
        else:
            dir_x, dir_y = 1, 0
        
        # Perpendicular vector (for corridor width)
        perp_x = -dir_y
        perp_y = dir_x
        
        # Generate grid
        cell_size_deg_lat = self.config.scan_cell_size_m / meters_per_deg_lat
        cell_size_deg_lon = self.config.scan_cell_size_m / meters_per_deg_lon
        
        num_cells_length = int(length_m / self.config.scan_cell_size_m) + 1
        
        line_spacing_m = self.config.corridor_width_m / (self.config.num_lines - 1) if self.config.num_lines > 1 else 0
        
        self.log.info(f"Generating scan grid: {self.config.num_lines} lines × {num_cells_length} cells")
        self.log.info(f"Corridor: {length_m:.1f}m long, {self.config.corridor_width_m:.1f}m wide")
        
        for line_idx in range(self.config.num_lines):
            # Offset from center line
            offset_m = (line_idx - (self.config.num_lines - 1) / 2) * line_spacing_m
            offset_deg_lat = offset_m * perp_y / meters_per_deg_lat
            offset_deg_lon = offset_m * perp_x / meters_per_deg_lon
            
            cells_in_line = []
            for i in range(num_cells_length):
                progress = i / max(num_cells_length - 1, 1)
                
                lat = start[0] + dy * progress + offset_deg_lat
                lon = start[1] + dx * progress + offset_deg_lon
                
                x_m = i * self.config.scan_cell_size_m
                y_m = offset_m + self.config.corridor_width_m / 2
                
                cells_in_line.append(ScanCell(
                    x_m=x_m,
                    y_m=y_m,
                    lat=lat,
                    lon=lon
                ))
            
            # Snake pattern: alternate direction for each line
            if line_idx % 2 == 1:
                cells_in_line.reverse()
            
            self.cells.extend(cells_in_line)
        
        self.log.info(f"Generated {len(self.cells)} scan cells")
        self.state = SweepState.SCANNING
    
    def get_next_waypoint(self) -> Optional[Tuple[float, float, float]]:
        """Get next scan position (lat, lon, alt)"""
        if self.current_cell_idx >= len(self.cells):
            return None
        
        cell = self.cells[self.current_cell_idx]
        return (cell.lat, cell.lon, self.config.altitude_m)
    
    def record_scan_result(self, mine_detected: bool, confidence: float):
        """Record detection result for current cell"""
        if self.current_cell_idx >= len(self.cells):
            return
        
        cell = self.cells[self.current_cell_idx]
        cell.scanned = True
        cell.result = 'mine' if mine_detected else 'clear'
        cell.confidence = confidence
        
        if mine_detected:
            self.detected_mines.add((cell.lat, cell.lon))
            self.log.warning(f"Mine detected at ({cell.lat:.6f}, {cell.lon:.6f}) with confidence {confidence:.2f}")
        
        self.current_cell_idx += 1
        
        # Check if sweep complete
        if self.current_cell_idx >= len(self.cells):
            self.state = SweepState.COMPLETE
            self.log.info(f"Scan complete. Detected {len(self.detected_mines)} mines.")
            self._calculate_safe_path()
    
    def _calculate_safe_path(self):
        """Use A* to find safe path avoiding detected mines"""
        try:
            # Try to import existing pathfinder
            import sys
            import os
            pathfinder_path = os.path.join(os.path.dirname(__file__), '..', 'pi_gps')
            if os.path.exists(pathfinder_path):
                sys.path.insert(0, pathfinder_path)
                from pathfinder import Pathfinder, PathfinderConfig
                
                pf_config = PathfinderConfig(
                    mine_circumvention_radius_m=2.0,
                    grid_resolution_m=0.5
                )
                pathfinder = Pathfinder(pf_config)
                
                # Add detected mines
                for mine_lat, mine_lon in self.detected_mines:
                    # Note: pathfinder expects (x, y) in local coords
                    # This is a simplified version - proper coordinate transformation needed
                    pathfinder.add_mine(mine_lon, mine_lat)
                
                # Find path
                start = (self.config.start[1], self.config.start[0])
                goal = (self.config.goal[1], self.config.goal[0])
                
                self.safe_path = pathfinder.find_path(start, goal)
                self.log.info(f"Calculated safe path with {len(self.safe_path)} waypoints")
            else:
                self.log.warning("Pathfinder not available, safe path not calculated")
                
        except Exception as e:
            self.log.error(f"Failed to calculate safe path: {e}")
    
    def get_safe_path(self) -> List[Tuple[float, float]]:
        """Get calculated safe path after sweep complete"""
        return self.safe_path
    
    def get_progress(self) -> float:
        """Get scan progress (0.0 - 1.0)"""
        if len(self.cells) == 0:
            return 0.0
        return self.current_cell_idx / len(self.cells)
    
    def get_statistics(self) -> dict:
        """Get current scan statistics"""
        return {
            'total_cells': len(self.cells),
            'scanned_cells': self.current_cell_idx,
            'mines_detected': len(self.detected_mines),
            'progress': self.get_progress(),
            'state': self.state.value
        }
