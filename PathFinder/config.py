"""
MineFinder Attachment Configuration
All settings are here - UI has no configuration for simulator/algorithm.
"""
import os
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv

load_dotenv()  # Load .env file


@dataclass
class MQTTConfig:
    """MQTT broker configuration (HiveMQ Cloud or other broker)"""
    broker_url: str = os.getenv("MQTT_BROKER_URL", "broker.hivemq.com")
    broker_port: int = int(os.getenv("MQTT_BROKER_PORT", "8883"))
    use_tls: bool = os.getenv("MQTT_USE_TLS", "true").lower() == "true"
    username: Optional[str] = os.getenv("MQTT_USERNAME")
    password: Optional[str] = os.getenv("MQTT_PASSWORD")


@dataclass
class DroneConfig:
    """Drone connection configuration"""
    connection_string: str = os.getenv("DRONE_CONNECTION", "/dev/ttyUSB0")
    baud: int = int(os.getenv("DRONE_BAUD", "57600"))
    default_altitude_m: float = float(os.getenv("DEFAULT_ALTITUDE_M", "10.0"))
    default_speed_ms: float = float(os.getenv("DEFAULT_SPEED_MS", "5.0"))
    waypoint_accept_radius_m: float = float(os.getenv("WAYPOINT_ACCEPT_RADIUS_M", "2.0"))


@dataclass
class BatteryConfig:
    """Battery monitoring and safety thresholds"""
    min_battery_pct: float = float(os.getenv("MIN_BATTERY_PCT", "20.0"))
    max_flight_time_min: float = float(os.getenv("MAX_FLIGHT_TIME_MIN", "15.0"))
    voltage_warning: float = float(os.getenv("VOLTAGE_WARNING", "11.1"))  # 3S LiPo warning
    voltage_critical: float = float(os.getenv("VOLTAGE_CRITICAL", "10.5"))  # 3S LiPo critical


@dataclass
class FailsafeConfig:
    """Failsafe behavior configuration"""
    gps_loss_action: str = os.getenv("GPS_LOSS_ACTION", "return_to_start")  # return_to_start | hover | land
    camera_failure_retries: int = int(os.getenv("CAMERA_FAILURE_RETRIES", "3"))
    camera_failure_action: str = os.getenv("CAMERA_FAILURE_ACTION", "return_to_start")  # return_to_start | continue
    ml_nan_action: str = os.getenv("ML_NAN_ACTION", "assume_mine")  # assume_mine | skip | retry
    comms_loss_action: str = os.getenv("COMMS_LOSS_ACTION", "continue")  # continue | return_to_start | hover


@dataclass
class SensorConfig:
    """Sensor configuration"""
    type: str = os.getenv("SENSOR_TYPE", "simulator")  # simulator | flir_vue_pro
    flir_device_id: int = int(os.getenv("FLIR_DEVICE_ID", "0"))
    test_images_dir: Optional[str] = os.getenv("TEST_IMAGES_DIR", "./test_images")


@dataclass
class SimulatorConfig:
    """Simulator mode configuration"""
    mine_probability: float = float(os.getenv("MINE_PROBABILITY", "0.05"))
    simulated_speed_ms: float = float(os.getenv("SIM_SPEED_MS", "2.0"))
    telemetry_hz: float = float(os.getenv("TELEMETRY_HZ", "5.0"))


@dataclass
class MLConfig:
    """Machine learning model configuration"""
    checkpoint_path: str = os.getenv("ML_CHECKPOINT", "./demo-MiniCenter/fold_1_best.pt")
    confidence_threshold: float = float(os.getenv("ML_CONFIDENCE_THRESHOLD", "0.5"))
    device: str = os.getenv("ML_DEVICE", "cpu")  # cpu | cuda


@dataclass
class AttachmentConfig:
    """Complete attachment configuration"""
    attachment_id: str = os.getenv("ATTACHMENT_ID", "minefinder-pi-001")
    attachment_name: str = os.getenv("ATTACHMENT_NAME", "MineFinder Drone Unit 1")
    mode: str = os.getenv("MODE", "simulator")  # simulator | real
    
    mqtt: MQTTConfig = field(default_factory=MQTTConfig)
    drone: DroneConfig = field(default_factory=DroneConfig)
    battery: BatteryConfig = field(default_factory=BatteryConfig)
    failsafe: FailsafeConfig = field(default_factory=FailsafeConfig)
    sensor: SensorConfig = field(default_factory=SensorConfig)
    simulator: SimulatorConfig = field(default_factory=SimulatorConfig)
    ml: MLConfig = field(default_factory=MLConfig)


# Global config instance
config = AttachmentConfig()
