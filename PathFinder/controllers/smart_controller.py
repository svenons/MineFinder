import heapq
import math
import time
from controllers.base import DroneController
from events import emit

class SmartController(DroneController):
    """
    A smart controller that autopilots the drone using A* pathfinding.
    """

    def __init__(self):
        super().__init__()
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
        return "Smart Autopilot"

    def start_navigation(self):
        """
        Starts the navigation to the goal.
        """
        if self.app.world.goal is None:
            self.app.show_toast("Set a goal first!", duration=2.0)
            return

        self.navigating = True
        self.path = self.find_path()
        self.original_path = list(self.path)  # Store the original path
        self.all_path_segments = []  # Clear all segments
        self.path_history = []  # Clear travel history
        self.current_segment_index = 0
        self.detected_mines = set()  # Clear detected mines - fresh scan
        self.backtrack_path = []
        self.backtrack_segment_index = None
        self.backtrack_progress = 0
        self.moving_back = False
        self.mine_position = None
        
        if not self.path:
            self.app.show_toast("No path to goal found!", duration=2.0)
            self.navigating = False
        else:
            # Add the original path as the first segment (green - will be the traveled path)
            self.all_path_segments.append({
                'path': list(self.path),
                'color': (0, 255, 0),  # Green for traveled path
                'is_active': True
            })
            self.app.show_toast("Path found! Starting navigation.", duration=2.0)
            emit("path_calculated", {"path": self.path, "length": len(self.path)})

    def stop_navigation(self):
        """
        Stops the navigation.
        """
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
        Sets a flag to handle mine detection in the update loop.
        """
        if not self.navigating:
            return
        
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

    def update(self, dt: float):
        """
        Moves the drone along the path.
        """
        if not self.navigating:
            return

        current_time = time.time()
        if current_time - self.last_move_time < self.move_delay:
            return

        self.last_move_time = current_time

        # Handle mine detection: prepare to move back to last safe position
        if self.pending_mine_detection and not self.moving_back:
            self.pending_mine_detection = False
            self.mine_position = (self.app.world.drone.x_cm, self.app.world.drone.y_cm)
            
            if self.last_safe_position and self.mine_position != self.last_safe_position:
                # Truncate the current active segment at the last safe position
                if self.current_segment_index < len(self.all_path_segments):
                    current_segment = self.all_path_segments[self.current_segment_index]
                    if self.last_safe_position in current_segment['path']:
                        truncate_index = current_segment['path'].index(self.last_safe_position) + 1
                        current_segment['path'] = current_segment['path'][:truncate_index]
                        current_segment['is_active'] = False  # Mark as completed
                
                # Record the retreat path so it stays visible on the canvas
                self.backtrack_path = self._build_backtrack_path(self.mine_position, self.last_safe_position)
                if self.backtrack_path and len(self.backtrack_path) > 1:
                    self.all_path_segments.append({
                        'path': list(self.backtrack_path),
                        'color': (255, 165, 0),  # Orange for the backtrack route
                        'is_active': True
                    })
                    self.backtrack_segment_index = len(self.all_path_segments) - 1
                    self.current_segment_index = self.backtrack_segment_index
                    self.backtrack_progress = 0
                else:
                    self.backtrack_segment_index = None
                    self.backtrack_progress = 0

                # Begin moving back along the recorded path
                self.moving_back = True
                self.app.show_toast(f"Mine detected at {self.mine_position[0]},{self.mine_position[1]}! Moving back...", duration=2.0)
            return

        # Handle moving back to last safe position
        if self.moving_back:
            current_pos = (self.app.world.drone.x_cm, self.app.world.drone.y_cm)
            
            # Check if we've reached the last safe position
            if current_pos == self.last_safe_position:
                self.moving_back = False
                if self.backtrack_segment_index is not None and self.backtrack_segment_index < len(self.all_path_segments):
                    self.all_path_segments[self.backtrack_segment_index]['is_active'] = False
                self.backtrack_path = []
                self.backtrack_segment_index = None
                self.backtrack_progress = 0
                
                # Recalculate path from last safe position
                new_path = self.find_path(start=self.last_safe_position)
                
                if new_path:
                    # Update detected mines to include this newly discovered mine
                    if self.mine_position:
                        self.detected_mines.add(self.mine_position)
                    
                    # Add the new rerouted segment (in blue)
                    self.all_path_segments.append({
                        'path': list(new_path),
                        'color': (100, 100, 255),  # Blue for reroute
                        'is_active': True
                    })
                    self.current_segment_index = len(self.all_path_segments) - 1
                    self.path = new_path
                    print(f"DEBUG: New path calculated, length: {len(new_path)}, first few: {new_path[:5] if len(new_path) > 5 else new_path}")
                    self.app.show_toast(f"Rerouting from {self.last_safe_position[0]},{self.last_safe_position[1]}", duration=2.0)
                    emit("path_rerouted", {"new_path": new_path, "from": self.last_safe_position})
                else:
                    self.app.show_toast("No path to goal found!", duration=2.0)
                    self.navigating = False
                self.mine_position = None
                return
            
            # Move one step along the recorded retreat path
            if self.backtrack_path and self.backtrack_progress < len(self.backtrack_path) - 1:
                next_index = self.backtrack_progress + 1
                next_target = self.backtrack_path[next_index]
                dx = next_target[0] - current_pos[0]
                dy = next_target[1] - current_pos[1]

                # Move via world to keep events and scans consistent
                self.app.world.move_drone(dx, dy)

                new_pos = (self.app.world.drone.x_cm, self.app.world.drone.y_cm)
                if new_pos == next_target:
                    self.backtrack_progress = next_index
                    if self.backtrack_segment_index is not None and self.backtrack_segment_index < len(self.all_path_segments):
                        is_last_step = self.backtrack_progress >= len(self.backtrack_path) - 1
                        self.all_path_segments[self.backtrack_segment_index]['is_active'] = not is_last_step
            else:
                # Fallback: step directly toward last safe position if no backtrack path
                dx = self.last_safe_position[0] - current_pos[0]
                dy = self.last_safe_position[1] - current_pos[1]
                step_x = 1 if dx > 0 else -1 if dx < 0 else 0
                step_y = 1 if dy > 0 else -1 if dy < 0 else 0
                if step_x or step_y:
                    self.app.world.move_drone(step_x, step_y)
            
            return

        # Check if we have a valid path
        if not self.path or len(self.path) <= 1:
            # We've reached the goal
            if self.app.world.goal and (self.app.world.drone.x_cm, self.app.world.drone.y_cm) == self.app.world.goal:
                self.navigating = False
                self.app.show_toast("Goal reached!", duration=2.0)
            else:
                print(f"DEBUG: Path too short or empty. path length: {len(self.path) if self.path else 0}")
            return

        # Get next position in path (index 1 since index 0 is current position)
        next_pos = self.path[1]
        print(f"DEBUG: Moving from {(self.app.world.drone.x_cm, self.app.world.drone.y_cm)} to {next_pos}")
        
        # Move the drone to the next position (normal movement)
        # The drone doesn't know if there's a mine - it will discover it after moving
        current_pos = (self.app.world.drone.x_cm, self.app.world.drone.y_cm)
        
        # Save current position as last safe position before moving
        self.last_safe_position = current_pos
        
        dx = next_pos[0] - current_pos[0]
        dy = next_pos[1] - current_pos[1]
        
        # Record current position in history before moving
        if current_pos not in self.path_history:
            self.path_history.append(current_pos)
        
        # Move the drone
        self.app.world.move_drone(dx, dy)
        
        # Update path to reflect the new current position
        # Remove the current position from the path
        if self.path and self.path[0] == current_pos:
            self.path = self.path[1:]

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

    def find_path(self, start=None):
        """
        Finds the shortest path from the drone's current position to the goal
        using the A* algorithm. Only avoids mines that have been detected by scanning.
        The drone scans and discovers mines as it moves.
        """
        if start is None:
            start = (self.app.world.drone.x_cm, self.app.world.drone.y_cm)
        goal = self.app.world.goal
        # Only avoid mines that have been detected by our scanning
        mines = self.detected_mines
        width = self.app.cfg.width_cm
        height = self.app.cfg.height_cm

        def heuristic(a, b):
            return math.sqrt((a[0] - b[0])**2 + (a[1] - b[1])**2)

        open_set = []
        heapq.heappush(open_set, (0, start))
        came_from = {}
        g_score = { (x, y): float('inf') for x in range(width) for y in range(height) }
        g_score[start] = 0
        f_score = { (x, y): float('inf') for x in range(width) for y in range(height) }
        f_score[start] = heuristic(start, goal)

        while open_set:
            _, current = heapq.heappop(open_set)

            if current == goal:
                path = []
                while current in came_from:
                    path.append(current)
                    current = came_from[current]
                path.append(start)
                return path[::-1]

            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                neighbor = (current[0] + dx, current[1] + dy)

                if not (0 <= neighbor[0] < width and 0 <= neighbor[1] < height):
                    continue

                if neighbor in mines:
                    continue

                tentative_g_score = g_score[current] + 1
                if tentative_g_score < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g_score
                    f_score[neighbor] = g_score[neighbor] + heuristic(neighbor, goal)
                    if neighbor not in [i[1] for i in open_set]:
                        heapq.heappush(open_set, (f_score[neighbor], neighbor))

        return []
