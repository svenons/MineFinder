"""Simulated thermal sensor for testing without hardware"""

from PIL import Image
import numpy as np
from pathlib import Path
from typing import Optional
import random
import logging


class SimulatedSensor:
    """
    Simulated thermal sensor for testing without hardware.
    Uses test images or generates random thermal-like images.
    """
    
    def __init__(self, test_images_dir: Optional[str] = None):
        self.log = logging.getLogger(__name__)
        self.test_images_dir = Path(test_images_dir) if test_images_dir else None
        self.images = []
        
        if self.test_images_dir and self.test_images_dir.exists():
            # Load test images if available
            for ext in ['*.jpg', '*.jpeg', '*.png']:
                self.images.extend(list(self.test_images_dir.glob(ext)))
            
            if self.images:
                self.log.info(f"Loaded {len(self.images)} test images from {test_images_dir}")
            else:
                self.log.info("No test images found, will generate random images")
        else:
            self.log.info("No test images directory, will generate random images")
    
    def connect(self) -> bool:
        """Simulate sensor connection"""
        self.log.info("Simulated sensor connected")
        return True
    
    def capture(self) -> Image.Image:
        """
        Capture a simulated thermal image.
        Returns either a test image or a generated random image.
        """
        if self.images:
            # Return random test image
            img_path = random.choice(self.images)
            self.log.debug(f"Using test image: {img_path.name}")
            return Image.open(img_path).convert('RGB')
        else:
            # Generate random thermal-like image (224x224 default for ML model)
            arr = np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8)
            return Image.fromarray(arr)
    
    def close(self):
        """Close sensor connection"""
        self.log.info("Simulated sensor closed")
