#!/usr/bin/env python3
"""
MineFinder Detection Attachment
Runs on Raspberry Pi mounted on drone.
"""

import logging
import time
import threading
from typing import Optional

from config import config
from mqtt.client import MineFinderMQTTClient
from sensors.flir_vue_pro import FLIRVueProSensor
from sensors.simulator import SimulatedSensor
from navigation.dronekit_controller import DroneKitController
from navigation.simulator import SimulatedDroneController, DroneConfig
from detection.mine_detector import MineDetector
from algorithms.corridor_sweep import CorridorSweepAlgorithm, CorridorConfig


class MineFinderAttachment:
    """Main attachment controller"""
    
    def __init__(self, cfg):
        self.config = cfg
        self.log = logging.getLogger(__name__)
        
        # MQTT client (connects to HiveMQ Cloud or other broker)
        self.mqtt = MineFinderMQTTClient(cfg.attachment_id)
        
        # Initialize components based on mode
        if cfg.mode == 'real':
            self.log.info("Initializing in REAL mode")
            self.sensor = FLIRVueProSensor(cfg.sensor.flir_device_id)
            
            drone_cfg = DroneConfig(
                connection_string=cfg.drone.connection_string,
                baud=cfg.drone.baud,
                min_battery_pct=cfg.battery.min_battery_pct,
                max_flight_time_min=cfg.battery.max_flight_time_min,
                default_altitude_m=cfg.drone.default_altitude_m,
                default_speed_ms=cfg.drone.default_speed_ms,
                waypoint_accept_radius_m=cfg.drone.waypoint_accept_radius_m
            )
            self.drone = DroneKitController(drone_cfg)
            self.detector = MineDetector('real', cfg.ml.checkpoint_path)
        else:
            self.log.info("Initializing in SIMULATOR mode")
            self.sensor = SimulatedSensor(cfg.sensor.test_images_dir)
            
            drone_cfg = DroneConfig(
                default_altitude_m=cfg.drone.default_altitude_m,
                default_speed_ms=cfg.simulator.simulated_speed_ms
            )
            self.drone = SimulatedDroneController(drone_cfg)
            self.detector = MineDetector('simulator', mine_probability=cfg.simulator.mine_probability)
        
        self.algorithm: Optional[CorridorSweepAlgorithm] = None
        self.running = False
        self.mission_active = False
        
        # Heartbeat thread
        self.heartbeat_thread = None
        self.heartbeat_running = False
    
    def start(self):
        """Connect to broker and start listening for commands"""
        # Connect to MQTT broker
        success = self.mqtt.connect(
            self.config.mqtt.broker_url,
            self.config.mqtt.broker_port,
            self.config.mqtt.username,
            self.config.mqtt.password,
            self.config.mqtt.use_tls
        )
        
        if not success:
            self.log.error("Failed to connect to MQTT broker")
            return False
        
        # Register command handlers
        self.mqtt.register_handler('mission_start', self._handle_mission_start)
        self.mqtt.register_handler('mission_stop', self._handle_mission_stop)
        
        # Connect to sensor and drone
        self.sensor.connect()
        self.drone.connect()
        
        # Publish online status
        self.mqtt.publish_status({
            'online': True,
            'mode': self.config.mode,
            'attachment_name': self.config.attachment_name,
            'capabilities': ['corridor_sweep', 'telemetry', 'detection']
        })
        
        # Start heartbeat
        self._start_heartbeat()
        
        self.log.info(f"Attachment {self.config.attachment_id} online in {self.config.mode} mode")
        self.running = True
        return True
    
    def _start_heartbeat(self):
        """Start heartbeat thread"""
        self.heartbeat_running = True
        
        def heartbeat_loop():
            while self.heartbeat_running:
                self.mqtt.publish_heartbeat()
                time.sleep(5)  # Every 5 seconds
        
        self.heartbeat_thread = threading.Thread(target=heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()
    
    def _handle_mission_start(self, payload: dict):
        """Handle mission start command from control panel"""
        try:
            mission_id = payload.get('mission_id', 'unknown')
            start = payload['start']
            goal = payload['goal']
            params = payload.get('parameters', {})
            
            self.log.info(f"Starting mission {mission_id}")
            self.log.info(f"  Start: ({start['lat']:.6f}, {start['lon']:.6f})")
            self.log.info(f"  Goal: ({goal['lat']:.6f}, {goal['lon']:.6f})")
            
            # Create corridor configuration
            corridor_config = CorridorConfig(
                start=(start['lat'], start['lon']),
                goal=(goal['lat'], goal['lon']),
                corridor_width_m=params.get('corridor_width_m', 3.0),
                scan_cell_size_m=params.get('grid_size_m', 1.0),
                altitude_m=params.get('altitude_m', 10.0),
                num_lines=params.get('num_lines', 3)
            )
            
            self.algorithm = CorridorSweepAlgorithm(corridor_config)
            self.mission_active = True
            
            # Start mission in separate thread
            mission_thread = threading.Thread(
                target=self._run_mission_loop,
                args=(mission_id, corridor_config),
                daemon=True
            )
            mission_thread.start()
            
        except Exception as e:
            self.log.error(f"Error starting mission: {e}")
            self.mqtt.publish_status({
                'state': 'error',
                'error': str(e)
            })
    
    def _handle_mission_stop(self, payload: dict):
        """Handle mission stop command"""
        self.log.info("Mission stop requested")
        self.mission_active = False
        
        # Land drone
        self.drone.land()
        
        self.mqtt.publish_status({
            'state': 'stopped',
            'ts': int(time.time() * 1000)
        })
    
    def _run_mission_loop(self, mission_id: str, corridor_config: CorridorConfig):
        """Main mission execution loop"""
        try:
            # Takeoff
            self.log.info(f"Taking off to {corridor_config.altitude_m}m...")
            self.drone.arm_and_takeoff(corridor_config.altitude_m)
            
            # Main scanning loop
            while self.mission_active:
                # Get next waypoint
                waypoint = self.algorithm.get_next_waypoint()
                if waypoint is None:
                    self.log.info("Scan complete!")
                    break
                
                lat, lon, alt = waypoint
                
                # Fly to waypoint
                self.log.debug(f"Flying to waypoint ({lat:.6f}, {lon:.6f})")
                success = self.drone.goto_and_wait(lat, lon, alt, timeout=120)
                
                if not success:
                    self.log.warning("Failed to reach waypoint, continuing...")
                
                # Capture thermal image
                image = self.sensor.capture()
                
                if image is None:
                    self.log.warning("Failed to capture image")
                    # Apply failsafe
                    if self.config.failsafe.camera_failure_action == 'return_to_start':
                        self.log.error("Camera failure, returning to start")
                        self.drone.return_to_start()
                        break
                    continue
                
                # Run detection
                result = self.detector.detect(image)
                
                # Record result
                self.algorithm.record_scan_result(
                    result['mine'],
                    result['confidence']
                )
                
                # Publish detection event
                self.mqtt.publish_detection({
                    'position': {'lat': lat, 'lon': lon, 'alt_m': alt},
                    'result': 'mine' if result['mine'] else 'clear',
                    'confidence': result['confidence'],
                    'sensor_id': result['sensor']
                })
                
                # Publish telemetry
                self._publish_telemetry()
            
            # Mission complete
            if self.mission_active:
                self.log.info("Mission complete, returning to start...")
                
                # Get safe path
                safe_path = self.algorithm.get_safe_path()
                if safe_path:
                    self.mqtt.publish_path(safe_path)
                
                # Return and land
                self.drone.return_to_start()
                self.drone.land()
                
                # Publish completion status
                stats = self.algorithm.get_statistics()
                self.mqtt.publish_status({
                    'state': 'complete',
                    'mission_id': mission_id,
                    'statistics': stats
                })
            
        except Exception as e:
            self.log.error(f"Mission error: {e}", exc_info=True)
            self.mqtt.publish_status({
                'state': 'error',
                'mission_id': mission_id,
                'error': str(e)
            })
            # Emergency landing
            self.drone.land()
        
        finally:
            self.mission_active = False
    
    def _publish_telemetry(self):
        """Publish current position and progress"""
        pos = self.drone.get_position()
        battery = self.drone.get_battery()
        
        telemetry = {
            'position': {'lat': pos[0], 'lon': pos[1], 'alt_m': pos[2]},
            'battery': battery,
            'state': 'scanning' if self.mission_active else 'idle'
        }
        
        if self.algorithm:
            stats = self.algorithm.get_statistics()
            telemetry.update({
                'progress': stats['progress'],
                'cells_scanned': stats['scanned_cells'],
                'total_cells': stats['total_cells'],
                'mines_detected': stats['mines_detected']
            })
        
        self.mqtt.publish_telemetry(telemetry)
    
    def stop(self):
        """Shutdown attachment"""
        self.log.info("Shutting down attachment...")
        self.running = False
        self.mission_active = False
        self.heartbeat_running = False
        
        # Close connections
        self.sensor.close()
        self.drone.close()
        self.mqtt.disconnect()
        
        self.log.info("Attachment stopped")


def main():
    """Main entry point"""
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    log = logging.getLogger(__name__)
    log.info("=" * 60)
    log.info("MineFinder Detection Attachment")
    log.info("=" * 60)
    
    # Load config
    log.info(f"Mode: {config.mode}")
    log.info(f"Attachment ID: {config.attachment_id}")
    log.info(f"MQTT Broker: {config.mqtt.broker_url}:{config.mqtt.broker_port}")
    
    # Create and start attachment
    attachment = MineFinderAttachment(config)
    
    if not attachment.start():
        log.error("Failed to start attachment")
        return 1
    
    # Keep running
    try:
        while attachment.running:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Keyboard interrupt received")
    finally:
        attachment.stop()
    
    return 0


if __name__ == '__main__':
    exit(main())
