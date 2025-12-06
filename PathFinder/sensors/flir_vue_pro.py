"""FLIR Vue Pro R thermal camera interface"""

import cv2
from PIL import Image
from typing import Optional
import logging


class FLIRVueProSensor:
    """
    FLIR Vue Pro R interface via USB video capture.
    Camera outputs analog video which can be captured via USB frame grabber.
    """
    
    def __init__(self, device_id: int = 0):
        self.device_id = device_id
        self.cap: Optional[cv2.VideoCapture] = None
        self.log = logging.getLogger(__name__)
    
    def connect(self) -> bool:
        """Connect to FLIR camera via video capture device"""
        try:
            self.cap = cv2.VideoCapture(self.device_id)
            if not self.cap.isOpened():
                self.log.error(f"Failed to open video device {self.device_id}")
                return False
            
            # Set capture properties if needed
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 512)
            
            self.log.info(f"FLIR Vue Pro connected on device {self.device_id}")
            return True
            
        except Exception as e:
            self.log.error(f"Failed to connect to FLIR camera: {e}")
            return False
    
    def capture(self) -> Optional[Image.Image]:
        """
        Capture a thermal image from the camera.
        Returns PIL Image or None if capture fails.
        """
        if not self.cap or not self.cap.isOpened():
            self.log.error("Camera not connected")
            return None
        
        ret, frame = self.cap.read()
        if not ret:
            self.log.error("Failed to capture frame")
            return None
        
        # Convert BGR to RGB
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return Image.fromarray(rgb)
    
    def close(self):
        """Close camera connection"""
        if self.cap:
            self.cap.release()
            self.log.info("FLIR Vue Pro disconnected")
