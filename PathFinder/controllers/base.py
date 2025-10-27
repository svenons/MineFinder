"""
Drone controller interface.
"""
from typing import Any, Dict

import pygame


class DroneController:
    """Interface for anything that can control the drone in the game.
    Implementations may listen to pygame events, timers, or external inputs.

    Controllers may also optionally implement `scan_at` which lets the drone
    query sensors after it moves to a new cell. The drone (world) invokes
    scanning; controllers must not call it themselves.

    Note: `scan_at` may be either a synchronous method returning a dict,
    or an `async def` coroutine returning a dict. The app will execute it
    off the main thread and handle awaiting when necessary.
    """

    def attach(self, app: Any) -> None:
        # Keep a reference to the App so controllers can access world, emit, etc.
        self.app = app

    def handle_pygame_event(self, e: pygame.event.Event) -> None:  # noqa: D401
        """Handle a pygame event (e.g., KEYDOWN)."""
        pass

    def update(self, dt: float) -> None:  # noqa: D401
        """Update per frame if needed."""
        pass

    # Optional capability: scanning
    async def scan_at(self, world: Any, x_cm: int, y_cm: int) -> Dict[str, Any]:  # noqa: D401
        """Return a dict with scan results for the cell (x_cm,y_cm).
        Implementations should be pure/side-effect-free and fast.
        Default implementation returns an empty result.
        """
        return {}
