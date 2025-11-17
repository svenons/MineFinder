#!/usr/bin/env python3
"""
A* Pathfinding Algorithm for Mine Detection and Safe Path Planning

Specifications:
- Takes start (A), goal (B), and mine positions
- Calculates scan width based on flight height and camera angle
- Performs A* search to find shortest safe path
- Respects mine circumvention radius and path width
- Supports preferred paths and blocking landmarks (future)
"""

import math
from dataclasses import dataclass
from typing import List, Tuple, Optional, Set
from heapq import heappush, heappop


@dataclass
class PathfinderConfig:
    """Configuration for the pathfinding algorithm"""
    flight_height_m: float = 50.0          # Camera flight height in meters
    camera_angle_deg: float = 45.0          # Camera angle from horizontal (degrees)
    path_width_m: float = 0.5               # Safe path width (meters) - minimal for tight spaces
    mine_circumvention_radius_m: float = 1.5  # Safety radius around mines (meters) - total 2m safe zone
    grid_resolution_m: float = 1.0          # Grid cell size (meters)
    
    @property
    def scannable_width_m(self) -> float:
        """Calculate scannable area width from flight height and camera angle"""
        # Simplified: scannable_width = 2 * flight_height * tan(angle)
        angle_rad = math.radians(self.camera_angle_deg)
        return 2 * self.flight_height_m * math.tan(angle_rad)
    
    @property
    def min_safe_distance_m(self) -> float:
        """Minimum safe distance from any mine"""
        return self.mine_circumvention_radius_m + self.path_width_m


class GridPoint:
    """Represents a point on the grid for pathfinding"""
    def __init__(self, x: int, y: int, g_cost: float = 0, h_cost: float = 0):
        self.x = x
        self.y = y
        self.g_cost = g_cost  # Cost from start
        self.h_cost = h_cost  # Heuristic cost to goal
        self.parent: Optional['GridPoint'] = None
    
    @property
    def f_cost(self) -> float:
        """Total cost: g + h"""
        return self.g_cost + self.h_cost
    
    def __lt__(self, other: 'GridPoint') -> bool:
        """For heap comparison"""
        return self.f_cost < other.f_cost
    
    def __eq__(self, other) -> bool:
        if not isinstance(other, GridPoint):
            return False
        return self.x == other.x and self.y == other.y
    
    def __hash__(self) -> int:
        return hash((self.x, self.y))
    
    def __repr__(self) -> str:
        return f"GridPoint({self.x}, {self.y}, f={self.f_cost:.1f})"


class Pathfinder:
    """A* pathfinding algorithm for mine avoidance"""
    
    def __init__(self, config: PathfinderConfig):
        self.config = config
        self.grid: List[List[bool]] = []  # True = blocked/unsafe
        self.width_cells = 0
        self.height_cells = 0
        self.mines: Set[Tuple[int, int]] = set()
        self.grid_offset_x = 0.0  # Offset to support negative coordinates
        self.grid_offset_y = 0.0
    
    def initialize_grid(self, width_m: float, height_m: float) -> None:
        """Initialize the grid with given dimensions"""
        self.width_cells = int(math.ceil(width_m / self.config.grid_resolution_m))
        self.height_cells = int(math.ceil(height_m / self.config.grid_resolution_m))
        self.grid = [[False] * self.width_cells for _ in range(self.height_cells)]
        self.mines.clear()
    
    def add_mine(self, x_m: float, y_m: float) -> None:
        """Add a mine at (x, y) in meters"""
        # Apply offset
        cell_x = int((x_m - self.grid_offset_x) / self.config.grid_resolution_m)
        cell_y = int((y_m - self.grid_offset_y) / self.config.grid_resolution_m)
        
        # Check bounds
        if not (0 <= cell_x < self.width_cells and 0 <= cell_y < self.height_cells):
            return  # Mine outside grid
        
        # Mark mine and circumvention radius as blocked
        # Use actual euclidean distance, not grid distance
        radius_cells = int(math.ceil(self.config.min_safe_distance_m / self.config.grid_resolution_m))
        blocked_count = 0
        
        for dx in range(-radius_cells, radius_cells + 1):
            for dy in range(-radius_cells, radius_cells + 1):
                nx = cell_x + dx
                ny = cell_y + dy
                if 0 <= nx < self.width_cells and 0 <= ny < self.height_cells:
                    # Check actual Euclidean distance from mine center
                    actual_dist_m = math.sqrt((nx - cell_x)**2 + (ny - cell_y)**2) * self.config.grid_resolution_m
                    if actual_dist_m <= self.config.min_safe_distance_m:
                        self.grid[ny][nx] = True
                        blocked_count += 1
        
        self.mines.add((cell_x, cell_y))
    
    def add_preferred_path(self, path_points: List[Tuple[float, float]]) -> None:
        """Add a preferred path (e.g., footpath) that should be prioritized"""
        # TODO: Implement preferred path handling
        pass
    
    def add_blocking_landmark(self, x_m: float, y_m: float, width_m: float, height_m: float) -> None:
        """Add a blocking landmark (river, collapsed building, etc.)"""
        # TODO: Implement blocking landmark handling
        pass
    
    def is_walkable(self, x_cells: int, y_cells: int) -> bool:
        """Check if a cell is walkable"""
        if not (0 <= x_cells < self.width_cells and 0 <= y_cells < self.height_cells):
            return False
        return not self.grid[y_cells][x_cells]
    
    def heuristic(self, current: GridPoint, goal: GridPoint) -> float:
        """Heuristic: Euclidean distance to goal"""
        dx = goal.x - current.x
        dy = goal.y - current.y
        return math.sqrt(dx*dx + dy*dy)
    
    def get_neighbors(self, point: GridPoint) -> List[GridPoint]:
        """Get valid neighboring cells (8-directional)"""
        neighbors = []
        directions = [
            (0, -1), (1, 0), (0, 1), (-1, 0),  # 4-directional
            (1, -1), (1, 1), (-1, 1), (-1, -1)  # diagonals
        ]
        
        for dx, dy in directions:
            nx, ny = point.x + dx, point.y + dy
            if self.is_walkable(nx, ny):
                # Cost: 1.0 for cardinal, sqrt(2) for diagonal
                cost = 1.414 if dx != 0 and dy != 0 else 1.0
                neighbor = GridPoint(nx, ny)
                neighbors.append((neighbor, cost))
        
        return neighbors
    
    def find_path(self, start_m: Tuple[float, float], goal_m: Tuple[float, float]) -> List[Tuple[float, float]]:
        """
        Find the shortest safe path from start to goal using A*.
        
        Args:
            start_m: (x, y) in meters
            goal_m: (x, y) in meters
        
        Returns:
            List of (x, y) waypoints in meters, or empty list if no path found
        """
        # Convert to grid coordinates with offset
        start_cells = (
            int((start_m[0] - self.grid_offset_x) / self.config.grid_resolution_m),
            int((start_m[1] - self.grid_offset_y) / self.config.grid_resolution_m)
        )
        goal_cells = (
            int((goal_m[0] - self.grid_offset_x) / self.config.grid_resolution_m),
            int((goal_m[1] - self.grid_offset_y) / self.config.grid_resolution_m)
        )
        
        # Check if start and goal are walkable
        if not self.is_walkable(*start_cells):
            # Start is blocked! Try to find nearby walkable cell
            for offset in [(0,1), (1,0), (0,-1), (-1,0), (1,1), (1,-1), (-1,1), (-1,-1)]:
                test_x = start_cells[0] + offset[0]
                test_y = start_cells[1] + offset[1]
                if self.is_walkable(test_x, test_y):
                    start_cells = (test_x, test_y)
                    break
            else:
                return []  # No walkable start found
        
        if not self.is_walkable(*goal_cells):
            # Goal is blocked! Try nearby cells
            for offset in [(0,1), (1,0), (0,-1), (-1,0), (1,1), (1,-1), (-1,1), (-1,-1)]:
                test_x = goal_cells[0] + offset[0]
                test_y = goal_cells[1] + offset[1]
                if self.is_walkable(test_x, test_y):
                    goal_cells = (test_x, test_y)
                    break
            else:
                return []  # No walkable goal found
        
        # A* search with proper open set tracking
        start_node = GridPoint(*start_cells, g_cost=0)
        goal_node = GridPoint(*goal_cells)
        start_node.h_cost = self.heuristic(start_node, goal_node)
        
        open_set = []
        open_set_lookup: Set[Tuple[int, int]] = set()  # Track what's in open set
        closed_set: Set[Tuple[int, int]] = set()
        
        heappush(open_set, start_node)
        open_set_lookup.add((start_node.x, start_node.y))
        
        iterations = 0
        max_iterations = min(self.width_cells * self.height_cells, 100000)  # Prevent infinite loops
        
        while open_set and iterations < max_iterations:
            iterations += 1
            current = heappop(open_set)
            open_set_lookup.discard((current.x, current.y))
            
            # Check if we reached goal
            if current.x == goal_node.x and current.y == goal_node.y:
                # Path found, reconstruct it
                path = []
                node = current
                while node is not None:
                    x_m = node.x * self.config.grid_resolution_m + self.grid_offset_x
                    y_m = node.y * self.config.grid_resolution_m + self.grid_offset_y
                    path.append((x_m, y_m))
                    node = node.parent
                return list(reversed(path))
            
            closed_set.add((current.x, current.y))
            
            # Check neighbors
            for neighbor, move_cost in self.get_neighbors(current):
                neighbor_key = (neighbor.x, neighbor.y)
                
                if neighbor_key in closed_set:
                    continue
                
                tentative_g = current.g_cost + move_cost
                
                # Only add if not already in open set, or if we found a better path
                if neighbor_key not in open_set_lookup:
                    neighbor.g_cost = tentative_g
                    neighbor.h_cost = self.heuristic(neighbor, goal_node)
                    neighbor.parent = current
                    heappush(open_set, neighbor)
                    open_set_lookup.add(neighbor_key)
        
        # No path found
        return []
    
    def draw_straight_line_path(self, start_m: Tuple[float, float], goal_m: Tuple[float, float]) -> List[Tuple[float, float]]:
        """
        Draw a straight line from start to goal for initial scan.
        Returns waypoints at regular intervals.
        """
        num_points = 20  # Number of waypoints
        path = []
        
        for i in range(num_points + 1):
            t = i / num_points
            x = start_m[0] + t * (goal_m[0] - start_m[0])
            y = start_m[1] + t * (goal_m[1] - start_m[1])
            path.append((x, y))
        
        return path
    
    def get_scan_pattern(self, start_m: Tuple[float, float], goal_m: Tuple[float, float]) -> List[Tuple[float, float]]:
        """
        Generate a scan pattern that covers the corridor between start and goal.
        Performs back-and-forth passes to achieve desired path width.
        """
        scannable_width = self.config.scannable_width_m
        num_passes = int(math.ceil(self.config.path_width_m / scannable_width))
        
        pattern = []
        
        for pass_num in range(num_passes):
            # Offset perpendicular to the line
            offset = (pass_num - num_passes / 2) * scannable_width
            
            # Create perpendicular vector
            dx = goal_m[0] - start_m[0]
            dy = goal_m[1] - start_m[1]
            length = math.sqrt(dx*dx + dy*dy)
            
            if length == 0:
                continue
            
            # Perpendicular unit vector (rotated 90 degrees)
            perp_x = -dy / length
            perp_y = dx / length
            
            # Start point of this pass
            pass_start = (
                start_m[0] + offset * perp_x,
                start_m[1] + offset * perp_y
            )
            
            # End point of this pass
            pass_end = (
                goal_m[0] + offset * perp_x,
                goal_m[1] + offset * perp_y
            )
            
            # Add waypoints for this pass
            num_points = 20
            for i in range(num_points + 1):
                t = i / num_points
                x = pass_start[0] + t * (pass_end[0] - pass_start[0])
                y = pass_start[1] + t * (pass_end[1] - pass_start[1])
                pattern.append((x, y))
        
        return pattern


# Example usage
if __name__ == '__main__':
    config = PathfinderConfig(
        flight_height_m=50.0,
        camera_angle_deg=45.0,
        path_width_m=5.0,
        mine_circumvention_radius_m=10.0,
        grid_resolution_m=0.5
    )
    
    pf = Pathfinder(config)
    pf.initialize_grid(100.0, 100.0)  # 100m x 100m area
    
    # Add some mines
    pf.add_mine(50.0, 50.0)
    pf.add_mine(60.0, 60.0)
    
    # Find path
    start = (10.0, 10.0)
    goal = (90.0, 90.0)
    
    path = pf.find_path(start, goal)
    print(f"Found path with {len(path)} waypoints")
    for i, (x, y) in enumerate(path):
        print(f"  {i}: ({x:.1f}, {y:.1f})")
    
    # Generate scan pattern
    scan_pattern = pf.get_scan_pattern(start, goal)
    print(f"\nScan pattern with {len(scan_pattern)} points")
