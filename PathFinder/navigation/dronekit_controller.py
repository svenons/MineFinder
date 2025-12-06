"""DroneKit-based drone controller for real hardware"""

from typing import Tuple, Optional, Callable
import time
import logging
import math


try:
    from dronekit import connect, VehicleMode, LocationGlobalRelative
    DRONEKIT_AVAILABLE = True
except ImportError:
    DRONEKIT_AVAILABLE = False
    logging.warning("DroneKit not installed. Real drone control unavailable.")


from .simulator import DroneConfig


class DroneKitController:
    """
    Drone control via DroneKit (abstracts MAVLink).
    Includes battery monitoring and failsafe handling.
    """
    
    def __init__(self, config: DroneConfig):
        if not DRONEKIT_AVAILABLE:
            raise ImportError("DroneKit not installed. Install with: pip install dronekit")
        
        self.config = config
        self.vehicle = None
        self.log = logging.getLogger(__name__)
        self.mission_start_pos: Optional[Tuple[float, float, float]] = None
        self.on_low_battery: Optional[Callable] = None
        self._mission_start_time: Optional[float] = None
    
    def connect(self) -> bool:
        """Connect to drone via MAVLink"""
        try:
            self.log.info(f"Connecting to drone at {self.config.connection_string}")
            self.vehicle = connect(
                self.config.connection_string, 
                baud=self.config.baud,
                wait_ready=True,
                timeout=30
            )
            self.log.info(f"Connected: {self.vehicle.version}")
            
            # Register battery callback
            @self.vehicle.on_attribute('battery')
            def battery_callback(self, attr_name, value):
                if value.level and value.level < self.config.min_battery_pct:
                    self.log.warning(f"Low battery: {value.level}%")
                    if self.on_low_battery:
                        self.on_low_battery()
                    else:
                        self.return_to_start()
            
            return True
            
        except Exception as e:
            self.log.error(f"Connection failed: {e}")
            return False
    
    def arm_and_takeoff(self, altitude_m: float) -> bool:
        """Arm drone and takeoff to specified altitude"""
        if not self.vehicle:
            return False
        
        # Store start position for RTL
        loc = self.vehicle.location.global_relative_frame
        self.mission_start_pos = (loc.lat, loc.lon, loc.alt or 0)
        self._mission_start_time = time.time()
        
        # Pre-arm checks
        self.log.info("Waiting for vehicle to be armable...")
        while not self.vehicle.is_armable:
            time.sleep(1)
        
        # Switch to GUIDED mode and arm
        self.log.info("Arming vehicle...")
        self.vehicle.mode = VehicleMode("GUIDED")
        self.vehicle.armed = True
        
        while not self.vehicle.armed:
            self.log.info("Waiting for arming...")
            time.sleep(1)
        
        # Takeoff
        self.log.info(f"Taking off to {altitude_m}m...")
        self.vehicle.simple_takeoff(altitude_m)
        
        # Wait to reach altitude
        while True:
            alt = self.vehicle.location.global_relative_frame.alt
            if alt >= altitude_m * 0.95:
                self.log.info(f"Reached altitude: {alt:.1f}m")
                break
            self.log.debug(f"Altitude: {alt:.1f}m")
            time.sleep(1)
        
        return True
    
    def goto(self, lat: float, lon: float, alt: float) -> bool:
        """Fly to GPS position"""
        if not self.vehicle:
            return False
        
        target = LocationGlobalRelative(lat, lon, alt)
        self.vehicle.simple_goto(target, groundspeed=self.config.default_speed_ms)
        return True
    
    def goto_and_wait(self, lat: float, lon: float, alt: float, 
                      timeout: float = 60.0) -> bool:
        """Fly to position and wait until arrived"""
        self.goto(lat, lon, alt)
        
        start = time.time()
        while time.time() - start < timeout:
            loc = self.vehicle.location.global_relative_frame
            dist = self._haversine_distance(loc.lat, loc.lon, lat, lon)
            
            if dist < self.config.waypoint_accept_radius_m:
                self.log.info(f"Arrived at waypoint ({lat:.6f}, {lon:.6f})")
                return True
            
            # Check mission time limit
            if self._check_flight_time_exceeded():
                self.log.warning("Flight time exceeded, returning to start")
                self.return_to_start()
                return False
            
            time.sleep(0.5)
        
        self.log.warning("Waypoint timeout")
        return False
    
    def get_position(self) -> Tuple[float, float, float]:
        """Get current GPS position"""
        if not self.vehicle:
            return (0.0, 0.0, 0.0)
        
        loc = self.vehicle.location.global_relative_frame
        return (loc.lat, loc.lon, loc.alt or 0)
    
    def get_battery(self) -> dict:
        """Get battery status"""
        if not self.vehicle:
            return {'voltage': 0, 'current': 0, 'level': 0}
        
        bat = self.vehicle.battery
        return {
            'voltage': bat.voltage,
            'current': bat.current,
            'level': bat.level
        }
    
    def return_to_start(self) -> bool:
        """Return to mission start position (not home, but where scan started)"""
        if self.mission_start_pos:
            lat, lon, alt = self.mission_start_pos
            self.log.info(f"Returning to start: ({lat:.6f}, {lon:.6f})")
            return self.goto_and_wait(lat, lon, alt, timeout=120)
        else:
            # Fallback to RTL mode
            self.log.warning("No start position, using RTL mode")
            if self.vehicle:
                self.vehicle.mode = VehicleMode("RTL")
            return True
    
    def land(self) -> bool:
        """Land at current position"""
        if self.vehicle:
            self.log.info("Landing...")
            self.vehicle.mode = VehicleMode("LAND")
            return True
        return False
    
    def _check_flight_time_exceeded(self) -> bool:
        """Check if max flight time exceeded"""
        if not self._mission_start_time:
            return False
        elapsed_min = (time.time() - self._mission_start_time) / 60
        return elapsed_min >= self.config.max_flight_time_min
    
    @staticmethod
    def _haversine_distance(lat1: float, lon1: float, 
                            lat2: float, lon2: float) -> float:
        """Calculate distance between two GPS points in meters"""
        R = 6371000  # Earth radius in meters
        
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R * c
    
    def close(self):
        """Disconnect from drone"""
        if self.vehicle:
            self.log.info("Disconnecting from drone...")
            self.vehicle.close()
