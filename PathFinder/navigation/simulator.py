"""Simulated drone controller for testing without hardware"""

import time
import random
import logging
from typing import Tuple, Optional
from dataclasses import dataclass


@dataclass 
class DroneConfig:
    """Drone configuration"""
    connection_string: str = "/dev/ttyUSB0"
    baud: int = 57600
    min_battery_pct: float = 20.0
    max_flight_time_min: float = 15.0
    default_altitude_m: float = 10.0
    default_speed_ms: float = 5.0
    waypoint_accept_radius_m: float = 2.0


class SimulatedDroneController:
    """Simulated drone for testing without hardware"""
    
    def __init__(self, config: Optional[DroneConfig] = None):
        self.config = config or DroneConfig()
        self.position = (0.0, 0.0, 0.0)  # lat, lon, alt
        self.battery_pct = 100.0
        self.armed = False
        self.mission_start_pos: Optional[Tuple[float, float, float]] = None
        self.log = logging.getLogger(__name__)
        self._mission_start_time: Optional[float] = None
    
    def connect(self) -> bool:
        """Simulate drone connection"""
        self.log.info("Simulated drone connected")
        return True
    
    def arm_and_takeoff(self, altitude_m: float) -> bool:
        """Simulate arming and takeoff"""
        self.mission_start_pos = self.position
        self._mission_start_time = time.time()
        self.armed = True
        
        # Simulate takeoff time
        time.sleep(0.5)
        
        self.position = (self.position[0], self.position[1], altitude_m)
        self.log.info(f"Simulated takeoff to {altitude_m}m")
        return True
    
    def goto(self, lat: float, lon: float, alt: float) -> bool:
        """Simulate flying to GPS position"""
        self.log.debug(f"Flying to ({lat:.6f}, {lon:.6f}, {alt:.1f}m)")
        return True
    
    def goto_and_wait(self, lat: float, lon: float, alt: float, 
                      timeout: float = 60.0) -> bool:
        """Simulate flying to position and waiting until arrived"""
        # Simulate flight time based on distance
        current_lat, current_lon, current_alt = self.position
        
        # Simple distance calculation (not accurate, just for simulation)
        dist = ((lat - current_lat)**2 + (lon - current_lon)**2)**0.5 * 111320  # rough meters
        flight_time = dist / self.config.default_speed_ms
        
        # Simulate flight (but keep it quick for testing)
        actual_wait = min(flight_time, 2.0)  # Cap at 2 seconds for simulation
        time.sleep(random.uniform(0.3, actual_wait))
        
        self.position = (lat, lon, alt)
        self.log.debug(f"Arrived at ({lat:.6f}, {lon:.6f}, {alt:.1f}m)")
        
        # Simulate battery drain
        self.battery_pct -= random.uniform(0.1, 0.5)
        
        return True
    
    def get_position(self) -> Tuple[float, float, float]:
        """Get current GPS position"""
        return self.position
    
    def get_battery(self) -> dict:
        """Get simulated battery status"""
        return {
            'voltage': 12.6 - (100 - self.battery_pct) * 0.02,
            'current': random.uniform(4.0, 6.0),
            'level': self.battery_pct
        }
    
    def return_to_start(self) -> bool:
        """Return to mission start position"""
        if self.mission_start_pos:
            lat, lon, alt = self.mission_start_pos
            self.log.info(f"Returning to start: ({lat:.6f}, {lon:.6f})")
            return self.goto_and_wait(lat, lon, alt, timeout=120)
        else:
            self.log.warning("No start position recorded")
            return True
    
    def land(self) -> bool:
        """Simulate landing"""
        self.log.info("Landing...")
        time.sleep(0.5)
        self.position = (self.position[0], self.position[1], 0.0)
        self.armed = False
        return True
    
    def close(self):
        """Disconnect from drone"""
        self.log.info("Simulated drone disconnected")
