"""Mine detection using ML model or simulation"""

from typing import Dict, Any
from PIL import Image
import logging
import random


class MineDetector:
    """
    Unified mine detection interface.
    Supports both real ML model and simulation mode.
    """
    
    def __init__(self, mode: str = 'simulator', checkpoint_path: str = None, mine_probability: float = 0.05):
        """
        Args:
            mode: 'real' for ML inference, 'simulator' for random detection
            checkpoint_path: Path to trained model (for real mode)
            mine_probability: Probability of mine detection in simulator mode (0.0-1.0)
        """
        self.mode = mode
        self.model = None
        self.mine_probability = mine_probability
        self.log = logging.getLogger(__name__)
        
        if mode == 'real' and checkpoint_path:
            try:
                import sys
                import os
                # Add EXP_T-ML-LWIR to path for model loading
                ml_path = os.path.join(os.path.dirname(__file__), '..', 'EXP_T-ML-LWIR')
                if os.path.exists(ml_path):
                    sys.path.insert(0, ml_path)
                    from main import LandmineDetector
                    self.model = LandmineDetector(checkpoint_path)
                    self.log.info(f"Loaded ML model from {checkpoint_path}")
                else:
                    self.log.warning(f"ML path not found: {ml_path}, falling back to simulator")
                    self.mode = 'simulator'
            except Exception as e:
                self.log.error(f"Failed to load ML model: {e}")
                self.log.warning("Falling back to simulator mode")
                self.mode = 'simulator'
    
    def detect(self, image: Image.Image) -> Dict[str, Any]:
        """
        Analyze image for mine presence.
        
        Returns:
            {
                'mine': bool,
                'confidence': float (0-1),
                'sensor': str ('flir_vue_pro' or 'simulator')
            }
        """
        if self.mode == 'simulator':
            return self._simulate_detection()
        else:
            return self._real_detection(image)
    
    def _simulate_detection(self) -> Dict[str, Any]:
        """Probabilistic mine detection in simulation (configurable probability)"""
        is_mine = random.random() < self.mine_probability
        confidence = random.uniform(0.8, 0.99) if is_mine else random.uniform(0.01, 0.2)
        
        return {
            'mine': is_mine,
            'confidence': confidence,
            'sensor': 'simulator'
        }
    
    def _real_detection(self, image: Image.Image) -> Dict[str, Any]:
        """Run ML model inference using trained checkpoint"""
        if not self.model:
            self.log.error("ML model not loaded, using fallback simulation")
            return self._simulate_detection()
        
        try:
            # Save temp file for model (it expects path)
            import tempfile
            import os
            
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
                temp_path = f.name
                image.save(temp_path)
            
            try:
                result = self.model.predict_image(temp_path)
            finally:
                # Clean up temp file
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
            
            return {
                'mine': result['predicted_class'] == 1,
                'confidence': result['probability'],
                'sensor': 'flir_vue_pro'
            }
            
        except Exception as e:
            self.log.error(f"ML inference failed: {e}")
            # Failsafe: assume mine (conservative approach)
            return {
                'mine': True,
                'confidence': 0.5,
                'sensor': 'flir_vue_pro_fallback'
            }
