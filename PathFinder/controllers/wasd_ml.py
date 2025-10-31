"""
WASD keyboard controller implementation.
"""
import pygame

from controllers.base import DroneController
from events import emit
import random

import sys
import importlib.util
from pathlib import Path
exp_ml_dir = Path(__file__).parent.parent / "EXP_T-ML-LWIR"
sys.path.insert(0, str(exp_ml_dir))

spec = importlib.util.spec_from_file_location(
    "exp_ml_main",
    Path(__file__).parent.parent / "EXP_T-ML-LWIR" / "main.py"
)
exp_ml_main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exp_ml_main)
LandmineDetector = exp_ml_main.LandmineDetector
try:
    from landmine_detector.main import LandmineDetector
except ImportError:
    print("Warning: Could not import LandmineDetector. ML functionality will be disabled.")
    LandmineDetector = None


MINE_IMG_DIR = "EXP_T-ML-LWIR/data/03_03_2020/JPG/Zone 2 Mine 1cm depth"
NO_MINE_IMG_DIR = "no_mines"
CHECKPOINT_PATH = "EXP_T-ML-LWIR/checkpoints/fold_0_best.pt"
MODE = "cuda"

class WASDMLController(DroneController):
    """Keyboard controller that moves the drone with W/A/S/D.

    It emits the same JSONL 'key_command' events and calls into
    the World's movement, keeping protocol compatibility.

    Also implements a trivial scanner: it reports whether the
    current cell contains a mine.

    Exposes settings for ML experimentation (placeholders for now):
    - mine_img_dir, img_dir, checkpoint_path, mode
    """

    def __init__(self):
        # Store applied settings (strings)
        self.settings = {
            "mine_img_dir": MINE_IMG_DIR,
            "img_dir": NO_MINE_IMG_DIR,
            "checkpoint_path": CHECKPOINT_PATH,
            "mode": MODE,
        }
        # Lazy-load ML model on settings apply to avoid init failures blocking controller switching
        self.ml_model = None


    def display_name(self) -> str:
        return "WASD ML"

    def settings_schema(self):
        return [
            {"key": "mine_img_dir", "label": "Mine images dir", "type": "text", "placeholder": MINE_IMG_DIR},
            {"key": "img_dir", "label": "Images dir", "type": "text", "placeholder": NO_MINE_IMG_DIR},
            {"key": "checkpoint_path", "label": "Checkpoint path", "type": "text", "placeholder": CHECKPOINT_PATH},
            {"key": "mode", "label": "Mode", "type": "text", "placeholder": MODE},
        ]

    def apply_settings(self, settings):
        # Keep only known keys as strings
        for k in list(self.settings.keys()):
            v = settings.get(k, "") if isinstance(settings, dict) else ""
            self.settings[k] = str(v)

    def on_settings_applied(self) -> None:
        """Reinitialize any ML resources based on current settings.
        Placeholder: just emits an event; replace with real model loading.
        """
        if LandmineDetector is None:
            print("Cannot initialize ML model: LandmineDetector not available.")
            self.ml_model = None
            return
        try:
            self.ml_model = LandmineDetector(
                self.settings["checkpoint_path"],
                self.settings["mode"]
            )
        except Exception:
            pass
        except Exception as e:
            print(f"Error initializing ML model: {e}")
            self.ml_model = None

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
        # Ensure model is initialized lazily
        if self.ml_model is None and LandmineDetector is not None:
            try:
                self.on_settings_applied()
            except Exception as e:
                print(f"Lazy initialization of ML model failed: {e}")
                self.ml_model = None

        if self.ml_model is None:
            return {"mine": False, "error": "ML model not loaded"}

        try:
            if self.ml_model is None:
                self.ml_model = LandmineDetector(
                    self.settings["checkpoint_path"],
                    self.settings["mode"]
                )
            dir_path = self.settings["mine_img_dir"] if (x_cm, y_cm) in world.mines else self.settings["img_dir"]
            path = self.get_random_jpg(dir_path)
            result = self.ml_model.predict_image(path) if self.ml_model else {"predicted_class": 0}
            is_mine = bool(result.get("predicted_class", 0) == 1) if isinstance(result, dict) else bool(result)
            return {"mine": is_mine}
        except Exception:
            result = self.ml_model.predict_image(path)
            is_mine = bool(result.get("predicted_class", 0) == 1)
            return {"mine": is_mine, "confidence": result.get("confidence", 0.0)}
        except Exception as e:
            # On any failure, report no mine to keep the game responsive
            print(f"Error during scan_at: {e}")
            return {"mine": False}

    @staticmethod
    def get_random_jpg(directory_path: str) -> Path:
        path = Path(directory_path)
        jpg_files = list(path.rglob("*.jpg")) + list(path.rglob("*.jpeg"))
        jpg_files += list(path.rglob("*.JPG")) + list(path.rglob("*.JPEG"))

        if not jpg_files:
            raise FileNotFoundError(f"No JPG files found in {directory_path}")

        return random.choice(jpg_files)
