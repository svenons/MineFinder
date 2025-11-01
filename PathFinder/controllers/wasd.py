"""
WASD keyboard controller implementation.
"""
import pygame

from controllers.base import DroneController
from events import emit


class WASDController(DroneController):
    """Keyboard controller that moves the drone with W/A/S/D.

    It emits the same JSONL 'key_command' events and calls into
    the World's movement, keeping protocol compatibility.

    Also implements a trivial scanner: it reports whether the
    current cell contains a mine.
    """

    KEYMAP = {
        pygame.K_w: (0, -1, "W"),
        pygame.K_a: (-1, 0, "A"),
        pygame.K_s: (0, 1, "S"),
        pygame.K_d: (1, 0, "D"),
    }

    def handle_pygame_event(self, e: pygame.event.Event) -> None:
        if e.type != pygame.KEYDOWN:
            return
        app = self.app
        # If any input widget is focused, let the UI consume typing
        if getattr(app, 'any_input_focused', None) and app.any_input_focused():
            return
        info = self.KEYMAP.get(e.key)
        if info is None:
            return
        dx, dy, label = info
        emit("key_command", {"key": label})
        app.world.move_drone(dx, dy)

    # Scanner: check if the cell is a mine
    async def scan_at(self, world, x_cm: int, y_cm: int):
        return {"mine": (x_cm, y_cm) in world.mines}
