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

    Controllers can also expose configurable settings to the UI via
    `settings_schema()` and receive user-provided values through
    `apply_settings(settings)`.
    """

    def attach(self, app: Any) -> None:
        # Keep a reference to the App so controllers can access world, emit, etc.
        self.app = app

    # ---- Metadata & settings API ----
    def display_name(self) -> str:
        """Human-friendly name shown in dropdown (override if needed)."""
        return self.__class__.__name__

    def settings_schema(self):
        """Return settings schema for dynamic UI.
        Format: list of dicts with keys:
          - key: str (identifier)
          - label: str (user label)
          - type: str (currently only "text")
          - placeholder: str (optional)
        """
        return []

    def apply_settings(self, settings: Dict[str, Any]) -> None:
        """Receive settings values, e.g., paths or modes. Default no-op."""
        pass

    def on_settings_applied(self) -> None:
        """Called by the App after `apply_settings`.
        Controllers can reinitialize models/resources here using current settings.
        Default implementation does nothing.
        """
        pass

    def handle_pygame_event(self, e: pygame.event.Event) -> None:  # noqa: D401
        """Handle a pygame event (e.g., KEYDOWN)."""
        pass

    def update(self, dt: float) -> None:  # noqa: D401
        """Update per frame if needed."""
        pass

    def get_paths_to_draw(self):
        """Return a list of path segments with their colors for rendering.
        Returns: List of tuples (path_list, color_tuple)
        Default implementation returns an empty list (no paths to draw).
        """
        return []

    # Optional capability: scanning
    async def scan_at(self, world: Any, x_cm: int, y_cm: int) -> Dict[str, Any]:  # noqa: D401
        """Return a dict with scan results for the cell (x_cm,y_cm).
        Implementations should be pure/side-effect-free and fast.
        Default implementation returns an empty result.
        """
        return {}
