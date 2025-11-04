"""
Main application class for the PathFinder UI.
"""
import json
import sys
import threading
import time
import asyncio
import inspect
from typing import List

import pygame

from events import emit
from models import Config
from world import World
from ui.widgets import TextInput, Button, Dropdown
from controllers.wasd import WASDController
from controllers.smart_controller import SmartController
#from controllers.wasd_ml import WASDMLController

# Layout/constants
SIDEBAR_W = 280
MAX_WIN_W = 1400
MAX_WIN_H = 950
MARGIN = 12


class App:
    def __init__(self):
        pygame.init()
        pygame.display.set_caption("PathFinder UI")
        self.font = pygame.font.SysFont(None, 22)
        self.font_small = pygame.font.SysFont(None, 18)

        self.cfg = Config()
        self.world = World(self.cfg)

        # UI state
        self.input_width = TextInput(pygame.Rect(16, 40, SIDEBAR_W - 32, 30), str(self.cfg.width_cm), numeric=True)
        self.input_height = TextInput(pygame.Rect(16, 100, SIDEBAR_W - 32, 30), str(self.cfg.height_cm), numeric=True)
        self.input_mpc = TextInput(pygame.Rect(16, 160, SIDEBAR_W - 32, 30), str(self.cfg.metres_per_cm), numeric=True)
        self.apply_btn = Button(pygame.Rect(16, 210, SIDEBAR_W - 32, 34), "Apply", self.apply_config)
        self.start_nav_btn = None
        self.clear_path_btn = None
        # Remove single path storage, will get paths from controller
        # self.path_to_draw = []
        # self.path_color = (100, 100, 255) # Default path color (blue)

        self.pixels_per_cm = 20  # base zoom; will be adapted to window
        self.canvas_rect = pygame.Rect(SIDEBAR_W + MARGIN, MARGIN, 800, 600)
        self.screen = None  # set in layout

        # Toasts
        self._toasts = []  # list of dicts: {"msg": str, "until": float}

        # Controllers registry and active controller
        self.controller_registry = {
            "wasd": WASDController,
            "smart": SmartController,
            # "wasd_ml": WASDMLController,
        }
        self.selected_controller_id = "wasd"
        self.active_controller = self.controller_registry[self.selected_controller_id]()
        self.active_controller.attach(self)

        # Controller settings UI state
        self.ctrl_settings_inputs = []  # list of dicts: {"key": str, "label": str, "input": TextInput}
        self.ctrl_apply_btn = Button(pygame.Rect(16, 370, SIDEBAR_W - 32, 30), "Apply Controller Settings", self.apply_controller_settings)

        # UI: controller dropdown (position will be refined in relayout)
        self.controller_dropdown = Dropdown(pygame.Rect(16, 290, SIDEBAR_W - 32, 30),
                                            self.get_controller_options(),
                                            self.selected_controller_id,
                                            self.on_controller_selected)
        # Build initial controller settings inputs
        self.rebuild_controller_settings_ui()

        # Provide scan hook to world
        self.world.scan_func = self.scan_cell

        self.relayout()
        emit("app_start", {
            "width_cm": self.cfg.width_cm,
            "height_cm": self.cfg.height_cm,
            "metres_per_cm": self.cfg.metres_per_cm,
        })
        # Start stdin command reader
        self._stop_reader = threading.Event()
        self._reader_thread = threading.Thread(target=self.stdin_reader, daemon=True)
        self._reader_thread.start()

    def start_navigation(self):
        if self.selected_controller_id == "smart":
            self.active_controller.start_navigation()
        else:
            self.show_toast("Switch to Smart Autopilot controller first!", duration=2.0)

    def clear_path(self):
        """Clear all paths and stop navigation."""
        if self.active_controller and hasattr(self.active_controller, 'stop_navigation'):
            self.active_controller.stop_navigation()
            self.show_toast("Path cleared", duration=1.5)
            emit("path_cleared", {})

    # -------- Controller UI/helpers --------
    def get_controller_options(self):
        opts = []
        for cid, cls in self.controller_registry.items():
            # Avoid instantiating controllers here to prevent heavy/fragile side-effects
            label = getattr(cls, "__name__", str(cid))
            # Optional nicer label: strip common suffix
            if label.endswith("Controller"):
                label = label[:-10].strip()
            opts.append((cid, label))
        return opts

    def on_controller_selected(self, controller_id: str):
        if controller_id == self.selected_controller_id:
            return
        self.selected_controller_id = controller_id
        cls = self.controller_registry.get(controller_id)
        if cls is None:
            return
        try:
            self.active_controller = cls()
            self.active_controller.attach(self)
            self.rebuild_controller_settings_ui()
            emit("controller_changed", {"id": controller_id, "name": self.active_controller.display_name()})
        except Exception:
            pass

    def rebuild_controller_settings_ui(self):
        self.ctrl_settings_inputs = []
        self.start_nav_btn = None
        self.clear_path_btn = None
        schema = []
        try:
            schema = self.active_controller.settings_schema() if self.active_controller else []  # type: ignore[attr-defined]
        except Exception:
            schema = []

        y = self.controller_dropdown.rect.bottom + 10

        if self.selected_controller_id == "smart":
            self.start_nav_btn = Button(pygame.Rect(16, y, SIDEBAR_W - 32, 34), "Start Navigation", self.start_navigation)
            y += 40
            self.clear_path_btn = Button(pygame.Rect(16, y, SIDEBAR_W - 32, 34), "Clear Path", self.clear_path)
            y += 40

        # Build inputs starting below dropdown
        for field in schema:
            key = field.get("key")
            label = field.get("label", key)
            ftype = field.get("type", "text")
            placeholder = field.get("placeholder", "")
            # Label rect is just used for drawing; input rect receives events
            input_rect = pygame.Rect(16, y + 14, SIDEBAR_W - 32, 28)
            ti = TextInput(input_rect, text="", numeric=(ftype == "number"), placeholder=placeholder)
            self.ctrl_settings_inputs.append({"key": key, "label": label, "input": ti})
            y += 56
        # Move the apply button just after the last input (or just below dropdown if none)
        self.ctrl_apply_btn.rect.y = y

    def apply_controller_settings(self):
        values = {}
        # Build effective values: if input is empty/whitespace, fall back to placeholder
        for item in self.ctrl_settings_inputs:
            key = item.get("key")
            ti: TextInput = item.get("input")
            raw = (ti.get_text() or "").strip()
            if raw == "":
                # Use the field's placeholder as the default if provided
                default_val = getattr(ti, 'placeholder', "")
                values[key] = default_val
            else:
                values[key] = raw
        try:
            if self.active_controller is not None:
                # First pass values to controller
                self.active_controller.apply_settings(values)  # type: ignore[attr-defined]
                # Allow the controller to perform any reinitialization based on the new settings
                if hasattr(self.active_controller, 'on_settings_applied'):
                    try:
                        self.active_controller.on_settings_applied()  # type: ignore[attr-defined]
                    except Exception:
                        pass
                # Emit event for telemetry/integration with effective values
                emit("controller_settings_applied", {
                    "id": self.selected_controller_id,
                    "name": getattr(self.active_controller, 'display_name', lambda: type(self.active_controller).__name__)(),
                    "values": values,
                })
                self.show_toast("Controller settings applied", duration=1.5)
        except Exception:
            pass

    def any_input_focused(self) -> bool:
        if self.input_width.focused or self.input_height.focused or self.input_mpc.focused:
            return True
        for item in self.ctrl_settings_inputs:
            if item["input"].focused:
                return True
        return False

    # -------- Layout / scaling --------
    def relayout(self):
        # Determine an initial window size that can contain the grid at the current pixels_per_cm
        ppc = self.pixels_per_cm
        grid_w_px = int(self.cfg.width_cm * ppc)
        grid_h_px = int(self.cfg.height_cm * ppc)
        total_w = SIDEBAR_W + MARGIN + grid_w_px + MARGIN
        total_h = MARGIN + grid_h_px + MARGIN

        # Clamp to some sane maximum initial window size
        while (total_w > MAX_WIN_W or total_h > MAX_WIN_H) and ppc > 6:
            ppc -= 1
            grid_w_px = int(self.cfg.width_cm * ppc)
            grid_h_px = int(self.cfg.height_cm * ppc)
            total_w = SIDEBAR_W + MARGIN + grid_w_px + MARGIN
            total_h = MARGIN + grid_h_px + MARGIN
        self.pixels_per_cm = ppc

        # Create/recreate screen with resizeable flag
        win_w = max(total_w, SIDEBAR_W + 2 * MARGIN + 400)
        win_h = max(total_h, 300)
        self.screen = pygame.display.set_mode((win_w, win_h), pygame.RESIZABLE)

        # After window is created, adapt the grid scale to fill the available window area
        self.update_scale_from_window(win_w, win_h)

    def update_scale_from_window(self, win_w: int, win_h: int):
        """Recompute pixels_per_cm and canvas_rect to fit the grid into the current window size.
        Keeps square cells and preserves the aspect ratio; uses integer pixels per cm for crisp lines.
        """
        # Available drawing area for the grid
        avail_w = max(1, win_w - (SIDEBAR_W + 2 * MARGIN))
        avail_h = max(1, win_h - (2 * MARGIN))
        # Compute the maximum integer pixels-per-cm that fits in both directions
        if self.cfg.width_cm <= 0 or self.cfg.height_cm <= 0:
            ppc = 1
        else:
            ppc_w = avail_w / self.cfg.width_cm
            ppc_h = avail_h / self.cfg.height_cm
            ppc = int(max(1, min(ppc_w, ppc_h)))
        self.pixels_per_cm = ppc
        grid_w_px = int(self.cfg.width_cm * ppc)
        grid_h_px = int(self.cfg.height_cm * ppc)
        # Update canvas rect anchored to the margins
        self.canvas_rect = pygame.Rect(SIDEBAR_W + MARGIN, MARGIN, grid_w_px, grid_h_px)

    # -------- Scanning & toasts --------
    def scan_cell(self, world, x_cm: int, y_cm: int):
        """Dispatch a (possibly slow) scan without blocking the game loop.
        Controllers may implement `scan_at` as sync or async; results are merged
        and emitted via a `drone_scan` event when ready. A toast is shown if a
        mine is detected.
        """
        def worker():
            result = {}
            controller = getattr(self, 'active_controller', None)
            if controller is not None:
                try:
                    part = controller.scan_at(world, x_cm, y_cm)  # type: ignore[attr-defined]
                    if inspect.isawaitable(part):
                        part = asyncio.run(part)
                    if isinstance(part, dict):
                        result.update(part)
                except Exception:
                    pass
            # UI side-effect: toast when mine detected
            if result.get("mine"):
                self.show_toast(f"Mine detected at {x_cm},{y_cm}")
                self.world.mines.add((x_cm, y_cm)) # Add detected mine to world state
                if self.active_controller is not None and hasattr(self.active_controller, 'on_mine_detected'):
                    self.active_controller.on_mine_detected() # Notify controller
            # Emit scan completion
            emit("drone_scan", {
                "x_cm": x_cm, "y_cm": y_cm,
                "x_m": x_cm * self.cfg.metres_per_cm,
                "y_m": y_cm * self.cfg.metres_per_cm,
                "result": result,
            })
        threading.Thread(target=worker, daemon=True).start()
        # Return immediately to avoid blocking
        return {}

    def show_toast(self, msg: str, duration: float = 2.0):
        now = time.time()
        # Keep list reasonably small
        self._toasts = [t for t in self._toasts if t.get("until", 0) > now]
        self._toasts.append({"msg": msg, "until": now + duration})
        # Optional: also emit a JSONL event for telemetry
        emit("toast", {"message": msg, "duration": duration})

    def draw_toasts(self, surf: pygame.Surface):
        # Purge expired
        now = time.time()
        self._toasts = [t for t in self._toasts if t.get("until", 0) > now]
        if not self._toasts:
            return
        # Draw toasts stacked at top of canvas
        x = self.canvas_rect.x + 10
        y = self.canvas_rect.y + 10
        pad_x, pad_y = 10, 6
        for t in self._toasts:
            msg = t.get("msg", "")
            txt = self.font.render(msg, True, (20, 20, 20))
            w = txt.get_width() + pad_x * 2
            h = txt.get_height() + pad_y * 2
            bg_rect = pygame.Rect(x, y, w, h)
            s = pygame.Surface((w, h), pygame.SRCALPHA)
            s.fill((255, 245, 180, 230))  # warm yellow
            surf.blit(s, (bg_rect.x, bg_rect.y))
            pygame.draw.rect(surf, (200, 160, 60), bg_rect, 1, border_radius=6)
            surf.blit(txt, (x + pad_x, y + pad_y))
            y += h + 8

    def apply_config(self):
        width_val = int(self.input_width.get_value(self.cfg.width_cm) or self.cfg.width_cm)
        height_val = int(self.input_height.get_value(self.cfg.height_cm) or self.cfg.height_cm)
        mpc_val = float(self.input_mpc.get_value(self.cfg.metres_per_cm) or self.cfg.metres_per_cm)
        width_val = max(1, min(500, width_val))
        height_val = max(1, min(500, height_val))
        mpc_val = max(0.001, min(1000.0, mpc_val))
        self.cfg.width_cm = width_val
        self.cfg.height_cm = height_val
        self.cfg.metres_per_cm = mpc_val
        # Reset world that depends on cfg sizes
        self.world = World(self.cfg)
        # Restore scan hook
        self.world.scan_func = self.scan_cell
        self.relayout()
        emit("config_update", {
            "width_cm": self.cfg.width_cm,
            "height_cm": self.cfg.height_cm,
            "metres_per_cm": self.cfg.metres_per_cm,
        })

    # -------- Input helpers --------
    def handle_mouse(self, e: pygame.event.Event):
        if e.type == pygame.MOUSEBUTTONDOWN:
            if self.canvas_rect.collidepoint(e.pos):
                gx = (e.pos[0] - self.canvas_rect.x)
                gy = (e.pos[1] - self.canvas_rect.y)
                cx = int(gx // self.pixels_per_cm)
                cy = int(gy // self.pixels_per_cm)
                if e.button == 1:
                    self.world.toggle_mine(cx, cy)
                elif e.button == 3:
                    self.world.set_goal(cx, cy)

        # Pass to widgets
        self.input_width.handle_event(e)
        self.input_height.handle_event(e)
        self.input_mpc.handle_event(e)
        self.apply_btn.handle_event(e)
        # Controller UI widgets
        was_open = self.controller_dropdown.open
        self.controller_dropdown.handle_event(e)
        # If the dropdown was open, consume the click to avoid click-through on inputs/buttons beneath
        if was_open:
            return
        # Also consume clicks directly on the dropdown area
        if (e.type in (pygame.MOUSEBUTTONDOWN, pygame.MOUSEBUTTONUP)) and self.controller_dropdown.rect.collidepoint(e.pos):
            return

        if self.start_nav_btn:
            self.start_nav_btn.handle_event(e)

        if self.clear_path_btn:
            self.clear_path_btn.handle_event(e)

        for item in self.ctrl_settings_inputs:
            item["input"].handle_event(e)
        self.ctrl_apply_btn.handle_event(e)

    def handle_keydown(self, e: pygame.event.Event):
        # If any text input is focused, they handle typing themselves.
        if self.any_input_focused():
            self.input_width.handle_event(e)
            self.input_height.handle_event(e)
            self.input_mpc.handle_event(e)
            for item in self.ctrl_settings_inputs:
                item["input"].handle_event(e)
            if e.key == pygame.K_RETURN:
                self.apply_config()
            return

        # Delegate to active controller (e.g., WASDController / WASDMLController)
        if self.active_controller is not None:
            self.active_controller.handle_pygame_event(e)

    # -------- Stdin command reader --------
    def stdin_reader(self):
        # Read lines from stdin; ignore errors
        while not self._stop_reader.is_set():
            line = sys.stdin.readline()
            if not line:
                # EOF or no input; sleep a bit to avoid busy loop
                time.sleep(0.05)
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            try:
                cmd = obj.get("cmd")
                if cmd == "move":
                    dir_ = obj.get("dir", "").upper()
                    mapping = {
                        "W": (0, -1),
                        "A": (-1, 0),
                        "S": (0, 1),
                        "D": (1, 0),
                    }
                    if dir_ in mapping:
                        emit("key_command", {"key": dir_})
                        dx, dy = mapping[dir_]
                        self.world.move_drone(dx, dy)
                elif cmd == "set_goal":
                    x = int(obj.get("x_cm", 0))
                    y = int(obj.get("y_cm", 0))
                    self.world.set_goal(x, y)
                elif cmd == "toggle_mine":
                    x = int(obj.get("x_cm", 0))
                    y = int(obj.get("y_cm", 0))
                    self.world.toggle_mine(x, y)
            except Exception:
                # Ignore any malformed commands
                pass

    # -------- Rendering --------
    def draw_sidebar(self, surf: pygame.Surface):
        # Background
        pygame.draw.rect(surf, (245, 245, 245), pygame.Rect(0, 0, SIDEBAR_W, surf.get_height()))
        title = self.font.render("PathFinder Controls", True, (30, 30, 30))
        surf.blit(title, (16, 10))
        # Labels
        surf.blit(self.font_small.render("Width (cm)", True, (60, 60, 60)), (16, 24))
        self.input_width.draw(surf, self.font)
        surf.blit(self.font_small.render("Height (cm)", True, (60, 60, 60)), (16, 84))
        self.input_height.draw(surf, self.font)
        surf.blit(self.font_small.render("Metres per cm", True, (60, 60, 60)), (16, 144))
        self.input_mpc.draw(surf, self.font)
        self.apply_btn.draw(surf, self.font)

        # Help
        y = 260
        help_lines = [
            "Mouse:",
            " - Left click: toggle mine",
            " - Right click: set goal",
            "Keyboard:",
            " - WASD: move drone",
            "Protocol: JSONL on stdout",
        ]
        # Controller selection
        surf.blit(self.font_small.render("Controller", True, (60, 60, 60)), (16, 270))
        # Draw dynamic controller settings and other UI first, then draw dropdown last for correct z-order
        # Dynamic controller settings depend on dropdown position for layout
        y = self.controller_dropdown.rect.bottom + 10

        if self.start_nav_btn:
            self.start_nav_btn.draw(surf, self.font)
            y = self.start_nav_btn.rect.bottom + 10

        if self.clear_path_btn:
            self.clear_path_btn.draw(surf, self.font)
            y = self.clear_path_btn.rect.bottom + 10

        for item in self.ctrl_settings_inputs:
            label = item.get("label", item.get("key", ""))
            surf.blit(self.font_small.render(label, True, (60, 60, 60)), (16, y))
            inp: TextInput = item["input"]
            # Adjust input y to be below label
            inp.rect.y = y + 16
            inp.draw(surf, self.font)
            y = inp.rect.bottom + 12
        # Apply settings button
        self.ctrl_apply_btn.rect.y = y
        self.ctrl_apply_btn.draw(surf, self.font)

        # Help
        y = self.ctrl_apply_btn.rect.bottom + 16
        help_lines = [
            "Mouse:",
            " - Left click: toggle mine",
            " - Right click: set goal",
            "Keyboard:",
            " - WASD: move drone",
            "Protocol: JSONL on stdout",
        ]
        for line in help_lines:
            surf.blit(self.font_small.render(line, True, (70, 70, 70)), (16, y))
            y += 18

        # Finally draw the dropdown on top so its open menu overlays other sidebar elements
        self.controller_dropdown.draw(surf, self.font)

    def draw_grid(self, surf: pygame.Surface):
        # Canvas bg
        pygame.draw.rect(surf, (255, 255, 255), self.canvas_rect)
        # Grid lines
        ppc = self.pixels_per_cm
        x0, y0 = self.canvas_rect.topleft
        # Vertical lines
        for x in range(self.cfg.width_cm + 1):
            X = x0 + x * ppc
            thick = (x % 10 == 0)
            color = (180, 180, 180) if thick else (220, 220, 220)
            pygame.draw.line(surf, color, (X, y0), (X, y0 + self.canvas_rect.height), 2 if thick else 1)
        # Horizontal lines
        for y in range(self.cfg.height_cm + 1):
            Y = y0 + y * ppc
            thick = (y % 10 == 0)
            color = (180, 180, 180) if thick else (220, 220, 220)
            pygame.draw.line(surf, color, (x0, Y), (x0 + self.canvas_rect.width, Y), 2 if thick else 1)

        # Mines
        for (cx, cy) in self.world.mines:
            cell_rect = pygame.Rect(x0 + cx * ppc + 1, y0 + cy * ppc + 1, ppc - 2, ppc - 2)
            pygame.draw.rect(surf, (200, 60, 60), cell_rect)

        # Goal
        if self.world.goal is not None:
            gx, gy = self.world.goal
            cx = x0 + gx * ppc
            cy = y0 + gy * ppc
            r = max(4, ppc // 2)
            pygame.draw.circle(surf, (60, 160, 60), (cx + ppc // 2, cy + ppc // 2), r)
            pygame.draw.circle(surf, (30, 120, 30), (cx + ppc // 2, cy + ppc // 2), r, 2)

        # Drone
        dx = x0 + self.world.drone.x_cm * ppc
        dy = y0 + self.world.drone.y_cm * ppc
        drone_rect = pygame.Rect(dx + 3, dy + 3, max(6, ppc - 6), max(6, ppc - 6))
        pygame.draw.rect(surf, (60, 120, 200), drone_rect, border_radius=4)
        pygame.draw.rect(surf, (30, 80, 160), drone_rect, 2, border_radius=4)

        # Draw paths from controller if available
        if self.active_controller is not None and hasattr(self.active_controller, 'get_paths_to_draw'):
            try:
                paths_to_draw = self.active_controller.get_paths_to_draw()
                for path_list, path_color in paths_to_draw:
                    if len(path_list) >= 2:
                        points = []
                        for (cx, cy) in path_list:
                            points.append((x0 + cx * ppc + ppc // 2, y0 + cy * ppc + ppc // 2))
                        # Draw all paths with consistent thickness
                        pygame.draw.lines(surf, path_color, False, points, 3)
                    elif len(path_list) == 1:
                        # Draw a single point as a small circle
                        cx, cy = path_list[0]
                        point_x = x0 + cx * ppc + ppc // 2
                        point_y = y0 + cy * ppc + ppc // 2
                        pygame.draw.circle(surf, path_color, (point_x, point_y), 3)
            except Exception as e:
                pass

        # Hover highlight
        mx, my = pygame.mouse.get_pos()
        if self.canvas_rect.collidepoint((mx, my)):
            cx = int((mx - x0) // ppc)
            cy = int((my - y0) // ppc)
            if 0 <= cx < self.cfg.width_cm and 0 <= cy < self.cfg.height_cm:
                hl = pygame.Rect(x0 + cx * ppc + 1, y0 + cy * ppc + 1, ppc - 2, ppc - 2)
                s = pygame.Surface((hl.width, hl.height), pygame.SRCALPHA)
                s.fill((100, 100, 100, 40))
                surf.blit(s, (hl.x, hl.y))

    # -------- Main loop --------
    def run(self):
        clock = pygame.time.Clock()
        running = True
        while running:
            dt = clock.tick(60) / 1000.0
            for e in pygame.event.get():
                if e.type == pygame.QUIT:
                    running = False
                elif e.type in (pygame.MOUSEBUTTONDOWN, pygame.MOUSEBUTTONUP):
                    self.handle_mouse(e)
                elif e.type == pygame.KEYDOWN:
                    self.handle_keydown(e)
                elif e.type == pygame.VIDEORESIZE:
                    # Recreate window to new size and rescale grid to fit available area
                    self.screen = pygame.display.set_mode((e.w, e.h), pygame.RESIZABLE)
                    self.update_scale_from_window(e.w, e.h)

            # Update widgets
            self.input_width.update(dt)
            self.input_height.update(dt)
            self.input_mpc.update(dt)
            # Update dynamic controller inputs
            for item in self.ctrl_settings_inputs:
                item["input"].update(dt)

            # Controllers may have time-based logic
            if self.active_controller is not None:
                self.active_controller.update(dt)

            # Draw
            assert self.screen is not None
            self.screen.fill((230, 230, 235))
            self.draw_sidebar(self.screen)
            self.draw_grid(self.screen)
            self.draw_toasts(self.screen)

            pygame.display.flip()

        self._stop_reader.set()
        pygame.quit()
