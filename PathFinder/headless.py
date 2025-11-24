#!/usr/bin/env python3
"""
Headless PathFinder entry point for Electron integration.
Reads world data from stdin as JSON and outputs path results to stdout.
No GUI, no pygame dependency.
"""
import json
import sys
import math
from typing import List, Tuple, Dict, Any, Optional
from dataclasses import dataclass
import heapq


@dataclass
class Position:
    x_cm: int
    y_cm: int


@dataclass
class Mine:
    position: Position
    radius_m: float = 3.0  # Default safe radius in meters


class PathFinderHeadless:
    def __init__(self, min_x: int, max_x: int, min_y: int, max_y: int, metres_per_cm: float):
        self.min_x = min_x
        self.max_x = max_x
        self.min_y = min_y
        self.max_y = max_y
        self.metres_per_cm = metres_per_cm
        self.known_mines: List[Mine] = []
        self.hidden_mines: List[Mine] = []
        
    def add_known_mine(self, x_cm: int, y_cm: int, radius_m: float = 3.0):
        """Add a known mine obstacle."""
        self.known_mines.append(Mine(Position(x_cm, y_cm), radius_m))

    def add_hidden_mine(self, x_cm: int, y_cm: int, radius_m: float = 3.0):
        """Add a hidden mine (ground truth)."""
        self.hidden_mines.append(Mine(Position(x_cm, y_cm), radius_m))
    
    def is_position_safe(self, x_cm: int, y_cm: int, buffer_m: float = 0.2) -> bool:
        """Check if a position is safe (not too close to any KNOWN mine)."""
        for mine in self.known_mines:
            # Calculate distance in meters
            dx = (x_cm - mine.position.x_cm) * self.metres_per_cm
            dy = (y_cm - mine.position.y_cm) * self.metres_per_cm
            distance = math.sqrt(dx * dx + dy * dy)
            
            # Check against mine radius plus buffer
            if distance < (mine.radius_m + buffer_m):
                return False
        return True
    
    def get_neighbors(self, pos: Position) -> List[Position]:
        """Get valid neighboring positions (8-directional movement)."""
        neighbors = []
        # Use larger steps for faster pathfinding over large areas
        step = 100  # 1 meter steps
        
        for dx in [-step, 0, step]:
            for dy in [-step, 0, step]:
                if dx == 0 and dy == 0:
                    continue
                
                nx = pos.x_cm + dx
                ny = pos.y_cm + dy
                
                # Check bounds
                if self.min_x <= nx <= self.max_x and self.min_y <= ny <= self.max_y:
                    # Check if safe with buffer
                    if self.is_position_safe(nx, ny, buffer_m=0.1):
                        neighbors.append(Position(nx, ny))
        
        return neighbors
    
    def heuristic(self, a: Position, b: Position) -> float:
        """Euclidean distance heuristic."""
        dx = a.x_cm - b.x_cm
        dy = a.y_cm - b.y_cm
        return math.sqrt(dx * dx + dy * dy)
    
    def find_path(self, start: Position, goal: Position) -> Optional[List[Position]]:
        """A* pathfinding algorithm with improved navigation."""
        # Check if start and goal are safe with minimal buffer
        if not self.is_position_safe(start.x_cm, start.y_cm, buffer_m=0.1):
            # Try to find nearby safe position for start
            # print(f"DEBUG: Start {start} is unsafe, searching for safe spot...", file=sys.stderr)
            found_safe = False
            for dx in range(-100, 101, 10):
                for dy in range(-100, 101, 10):
                    new_start = Position(start.x_cm + dx, start.y_cm + dy)
                    if self.min_x <= new_start.x_cm <= self.max_x and self.min_y <= new_start.y_cm <= self.max_y:
                        if self.is_position_safe(new_start.x_cm, new_start.y_cm, buffer_m=0.1):
                            start = new_start
                            found_safe = True
                            break
                if found_safe: break
            
            if not found_safe:
                # print("DEBUG: Could not find safe start position", file=sys.stderr)
                return None
        
        if not self.is_position_safe(goal.x_cm, goal.y_cm, buffer_m=0.1):
            # Try to find nearby safe position for goal
            # print(f"DEBUG: Goal {goal} is unsafe, searching for safe spot...", file=sys.stderr)
            found_safe = False
            for dx in range(-100, 101, 10):
                for dy in range(-100, 101, 10):
                    new_goal = Position(goal.x_cm + dx, goal.y_cm + dy)
                    if self.min_x <= new_goal.x_cm <= self.max_x and self.min_y <= new_goal.y_cm <= self.max_y:
                        if self.is_position_safe(new_goal.x_cm, new_goal.y_cm, buffer_m=0.1):
                            goal = new_goal
                            found_safe = True
                            break
                if found_safe: break
            
            if not found_safe:
                # print("DEBUG: Could not find safe goal position", file=sys.stderr)
                return None
        
        # Priority queue: (f_score, counter, position)
        counter = 0
        open_set = [(0, counter, start)]
        came_from: Dict[Tuple[int, int], Position] = {}
        
        g_score: Dict[Tuple[int, int], float] = {(start.x_cm, start.y_cm): 0}
        f_score: Dict[Tuple[int, int], float] = {(start.x_cm, start.y_cm): self.heuristic(start, goal)}
        
        open_set_hash = {(start.x_cm, start.y_cm)}
        
        max_iterations = 30000  # Limit iterations for large spaces
        iterations = 0
        
        while open_set and iterations < max_iterations:
            iterations += 1
            _, _, current = heapq.heappop(open_set)
            current_key = (current.x_cm, current.y_cm)
            
            if current_key in open_set_hash:
                open_set_hash.remove(current_key)
            
            # Goal reached (tolerance matching step size)
            if abs(current.x_cm - goal.x_cm) <= 150 and abs(current.y_cm - goal.y_cm) <= 150:
                # Reconstruct path
                path = [goal]  # End at actual goal
                while current_key in came_from:
                    current = came_from[current_key]
                    current_key = (current.x_cm, current.y_cm)
                    path.append(current)
                path.reverse()
                
                # Simplify path (remove redundant waypoints)
                return self.simplify_path(path)
            
            # Explore neighbors
            for neighbor in self.get_neighbors(current):
                neighbor_key = (neighbor.x_cm, neighbor.y_cm)
                
                # Calculate distance
                dx = neighbor.x_cm - current.x_cm
                dy = neighbor.y_cm - current.y_cm
                distance = math.sqrt(dx * dx + dy * dy)
                
                tentative_g_score = g_score[current_key] + distance
                
                if neighbor_key not in g_score or tentative_g_score < g_score[neighbor_key]:
                    came_from[neighbor_key] = current
                    g_score[neighbor_key] = tentative_g_score
                    f_score[neighbor_key] = tentative_g_score + self.heuristic(neighbor, goal)
                    
                    if neighbor_key not in open_set_hash:
                        counter += 1
                        heapq.heappush(open_set, (f_score[neighbor_key], counter, neighbor))
                        open_set_hash.add(neighbor_key)
        
        # No path found
        return None
    
    def simplify_path(self, path: List[Position]) -> List[Position]:
        """Remove redundant waypoints from path."""
        if len(path) <= 2:
            return path
        
        simplified = [path[0]]
        
        for i in range(1, len(path) - 1):
            prev = simplified[-1]
            current = path[i]
            next_pos = path[i + 1]
            
            # Check if we can skip current waypoint (direct line from prev to next is safe)
            if not self.can_go_direct(prev, next_pos):
                simplified.append(current)
        
        simplified.append(path[-1])
        return simplified
    
    def simulate_mission(self, start: Position, goal: Position) -> List[Position]:
        """Simulate the drone flying, detecting mines, and replanning."""
        current = start
        history = [current]
        
        # Output initial position
        print(json.dumps({
            'type': 'drone_position',
            'ts': 0,
            'data': {'x_cm': current.x_cm, 'y_cm': current.y_cm}
        }), flush=True)
        
        # Limit total steps to prevent infinite loops
        max_steps = 400
        steps = 0
        
        # Detection range (simulated sensor) - detect mines ahead
        sensor_range_m = 5.0
        
        # Goal tolerance
        goal_tolerance_cm = 100
        
        # Movement parameters
        visual_step_cm = 50  # Small steps for smooth visualization
        
        while steps < max_steps:
            # Check if reached goal
            dist_to_goal = math.sqrt((current.x_cm - goal.x_cm)**2 + (current.y_cm - goal.y_cm)**2)
            if dist_to_goal < goal_tolerance_cm:
                # Add goal as final point
                history.append(goal)
                print(json.dumps({
                    'type': 'drone_position',
                    'ts': steps,
                    'data': {'x_cm': goal.x_cm, 'y_cm': goal.y_cm}
                }), flush=True)
                break
            
            # Plan path with currently known mines
            planned_path = self.find_path(current, goal)
            
            if not planned_path or len(planned_path) <= 1:
                # No path - try moving directly toward goal
                dx = goal.x_cm - current.x_cm
                dy = goal.y_cm - current.y_cm
                dist = math.sqrt(dx*dx + dy*dy)
                if dist < goal_tolerance_cm:
                    history.append(goal)
                    print(json.dumps({
                        'type': 'drone_position',
                        'ts': steps,
                        'data': {'x_cm': goal.x_cm, 'y_cm': goal.y_cm}
                    }), flush=True)
                    break
                
                # Take a small step toward goal
                move_dist = min(visual_step_cm, dist)
                ratio = move_dist / dist
                current = Position(int(current.x_cm + dx * ratio), int(current.y_cm + dy * ratio))
                history.append(current)
                steps += 1
                
                print(json.dumps({
                    'type': 'drone_position',
                    'ts': steps,
                    'data': {'x_cm': current.x_cm, 'y_cm': current.y_cm}
                }), flush=True)
                continue
            
            # Get next waypoint from planned path
            next_wp = planned_path[1] if len(planned_path) > 1 else goal
            
            # Move toward next waypoint in small steps
            dx = next_wp.x_cm - current.x_cm
            dy = next_wp.y_cm - current.y_cm
            dist = math.sqrt(dx*dx + dy*dy)
            
            if dist < visual_step_cm:
                # Close enough, jump to waypoint
                current = next_wp
            else:
                # Take a small step toward waypoint
                ratio = visual_step_cm / dist
                current = Position(int(current.x_cm + dx * ratio), int(current.y_cm + dy * ratio))
            
            history.append(current)
            steps += 1
            
            # Output current position
            print(json.dumps({
                'type': 'drone_position',
                'ts': steps,
                'data': {'x_cm': current.x_cm, 'y_cm': current.y_cm}
            }), flush=True)
            
            # Scan for mines from current position
            detected_new = False
            for mine in self.hidden_mines:
                mdx = (current.x_cm - mine.position.x_cm) * self.metres_per_cm
                mdy = (current.y_cm - mine.position.y_cm) * self.metres_per_cm
                mdist = math.sqrt(mdx*mdx + mdy*mdy)
                
                if mdist <= sensor_range_m:
                    # Check if mine is already known
                    already_known = any(
                        km.position.x_cm == mine.position.x_cm and km.position.y_cm == mine.position.y_cm
                        for km in self.known_mines
                    )
                    if not already_known:
                        # NEW MINE DETECTED! Add to known mines
                        self.known_mines.append(mine)
                        detected_new = True
                        
                        # Output detection event
                        print(json.dumps({
                            'type': 'mine_detected',
                            'ts': steps,
                            'data': {'x_cm': mine.position.x_cm, 'y_cm': mine.position.y_cm}
                        }), flush=True)
            
            # If new mine detected, immediately replan from current position
            # This creates the "backtrack and avoid" behavior
            if detected_new:
                # Output replanning event
                print(json.dumps({
                    'type': 'replanning',
                    'ts': steps,
                    'data': {'reason': 'mine_detected'}
                }), flush=True)
                
        return history

    def can_go_direct(self, start: Position, end: Position) -> bool:
        """Check if we can go directly from start to end without hitting mines."""
        steps = max(abs(end.x_cm - start.x_cm), abs(end.y_cm - start.y_cm))
        if steps == 0:
            return True
        
        for i in range(steps + 1):
            t = i / steps
            x = int(start.x_cm + t * (end.x_cm - start.x_cm))
            y = int(start.y_cm + t * (end.y_cm - start.y_cm))
            
            # Use 5cm buffer for path simplification check
            if not self.is_position_safe(x, y, buffer_m=0.1):
                return False
        
        return True


def main():
    """Main entry point - reads JSON from stdin, computes path, outputs to stdout."""
    try:
        # Read world data from stdin
        input_data = sys.stdin.read()
        world_export = json.loads(input_data)
        
        # Extract configuration
        config = world_export.get('config', {})
        metres_per_cm = config.get('metres_per_cm', 0.01)
        
        # Extract start and goal
        start_data = world_export.get('start', {})
        goal_data = world_export.get('goal', {})
        
        start = Position(start_data.get('x_cm', 0), start_data.get('y_cm', 0))
        goal = Position(goal_data.get('x_cm', 0), goal_data.get('y_cm', 0))
        
        # Extract mines
        mines_data = world_export.get('mines', [])
        
        # Calculate bounds dynamically
        all_x = [start.x_cm, goal.x_cm]
        all_y = [start.y_cm, goal.y_cm]
        
        for m in mines_data:
            all_x.append(m.get('x_cm', 0))
            all_y.append(m.get('y_cm', 0))
            
        padding = 1000 # 10 meters padding to allow going around mines
        min_x = min(all_x) - padding
        max_x = max(all_x) + padding
        min_y = min(all_y) - padding
        max_y = max(all_y) + padding
        
        # Create pathfinder
        pathfinder = PathFinderHeadless(min_x, max_x, min_y, max_y, metres_per_cm)
        
        # Add mines as HIDDEN mines for simulation
        for mine in mines_data:
            mine_x = mine.get('x_cm', 0)
            mine_y = mine.get('y_cm', 0)
            pathfinder.add_hidden_mine(mine_x, mine_y, radius_m=3.0)
        
        # Run simulation
        path = pathfinder.simulate_mission(start, goal)
        
        # Output result
        if path and len(path) > 1:
            waypoints = [{'x_cm': pos.x_cm, 'y_cm': pos.y_cm} for pos in path]
            
            # Also output the detected mines for visualization
            detected_mines = [{'x_cm': m.position.x_cm, 'y_cm': m.position.y_cm} for m in pathfinder.known_mines]
            
            result = {
                'type': 'path_result',
                'ts': 0,
                'data': {
                    'waypoints': waypoints,
                    'detected_mines': detected_mines,
                    'success': True
                }
            }
        else:
            result = {
                'type': 'path_result',
                'ts': 0,
                'data': {
                    'waypoints': [],
                    'success': False,
                    'error': 'No path found'
                }
            }
        
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        error_result = {
            'type': 'error',
            'ts': 0,
            'data': {
                'error': str(e)
            }
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
