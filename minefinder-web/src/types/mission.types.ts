/**
 * Core data models for MineFinder Mission Controller
 * Based on PathFinder events.py protocol structure
 */

// ============================================================================
// Coordinate System
// ============================================================================

/**
 * Position in centimeters (grid-based coordinate system)
 * Matches PathFinder's Config and World coordinate model
 */
export interface PositionCm {
  x_cm: number;
  y_cm: number;
}

/**
 * Position in meters (real-world coordinate system)
 */
export interface PositionM {
  x_m: number;
  y_m: number;
}

/**
 * Combined position with both coordinate systems
 */
export interface Position {
  x_cm: number;
  y_cm: number;
  x_m: number;
  y_m: number;
}

// ============================================================================
// Mission Definition
// ============================================================================

/**
 * Mission configuration sent to drones/attachments
 */
export interface Mission {
  /** Unique mission identifier */
  mission_id: string;
  
  /** Starting position (Point A) */
  start: Position;
  
  /** Goal/destination position (Point B) */
  goal: Position;
  
  /** Optional scan corridor bounds (defines area to scan between A and B) */
  corridor?: {
    width_cm: number;
    height_cm: number;
  };
  
  /** Conversion factor between cm and meters */
  metres_per_cm: number;
  
  /** Mission parameters */
  parameters: MissionParameters;
  
  /** Timestamp when mission was created */
  created_at: number;
  
  /** Mission status */
  status: MissionStatus;
}

export interface MissionParameters {
  /** Flight altitude in meters */
  altitude_m?: number;
  
  /** Drone speed in m/s */
  speed_ms?: number;
  
  /** Scan pattern type */
  pattern?: 'grid' | 'waypoint' | 'corridor';
  
  /** Detection confidence threshold (0-1) */
  confidence_threshold?: number;
  
  /** Communication mode */
  comm_mode?: 'realtime' | 'batch';
}

export type MissionStatus = 
  | 'pending'      // Created but not sent
  | 'active'       // Sent to drones, in progress
  | 'completed'    // All scans received
  | 'aborted'      // Manually cancelled
  | 'failed';      // Error occurred

// ============================================================================
// Detection Events
// ============================================================================

/**
 * Mine detection event from a sensor/attachment
 * Extends PathFinder's drone_scan event with confidence and sensor tracking
 */
export interface DetectionEvent {
  /** Position where detection occurred */
  position: Position;
  
  /** Detection confidence level (0-1, where 1 = certain mine) */
  confidence: number;
  
  /** ID of the sensor/attachment that made the detection */
  sensor_id: string;
  
  /** Timestamp of detection (Unix epoch) */
  timestamp: number;
  
  /** Optional: raw sensor data/metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated mine detection (de-duplicated)
 * Stores the highest confidence detection for a given coordinate
 */
export interface AggregatedDetection {
  /** Position key: "x_cm_y_cm" for efficient lookups */
  position_key: string;
  
  /** Position data */
  position: Position;
  
  /** Highest confidence value from all detections at this position */
  confidence: number;
  
  /** ID of sensor that provided highest confidence */
  primary_sensor_id: string;
  
  /** All detections at this position (for audit trail) */
  detections: DetectionEvent[];
  
  /** Timestamp of first detection */
  first_detected: number;
  
  /** Timestamp of last update */
  last_updated: number;
}

// ============================================================================
// Attachment/Sensor Registry
// ============================================================================

/**
 * Sensor/attachment configuration and status
 */
export interface Attachment {
  /** Unique identifier (e.g., "drone_01_metal") */
  id: string;
  
  /** Sensor type */
  type: SensorType;
  
  /** Current operational status */
  status: AttachmentStatus;
  
  /** Sensor specifications */
  specs: SensorSpecs;
  
  /** Communication info */
  comm: {
    /** Last successful communication timestamp */
    last_seen: number;
    
    /** Signal strength (0-100, if applicable) */
    signal_strength?: number;
    
    /** Communication module type */
    module_type?: string;
  };
  
  /** Battery level (0-100) if applicable */
  battery?: number;
  
  /** Current position if GPS available */
  position?: Position;
}

export type SensorType = 
  | 'metal_detector'
  | 'thermal'
  | 'ground_penetrating_radar'
  | 'multi_sensor'
  | 'unknown';

export type AttachmentStatus =
  | 'online'        // Active and responding
  | 'offline'       // Not responding
  | 'standby'       // Connected but idle
  | 'scanning'      // Currently scanning
  | 'error'         // Error state
  | 'calibrating';  // Calibration in progress

export interface SensorSpecs {
  /** Sensor model/version */
  model: string;
  
  /** Detection range in meters */
  range_m?: number;
  
  /** Accuracy specification */
  accuracy?: string;
  
  /** ML model version (if applicable) */
  ml_model_version?: string;
  
  /** Calibration date */
  calibrated_at?: number;
  
  /** Additional sensor-specific properties */
  [key: string]: unknown;
}

// ============================================================================
// Attachment Registry
// ============================================================================

/**
 * Registry configuration structure
 */
export interface AttachmentRegistry {
  /** Pre-configured known attachments */
  known_attachments: Attachment[];
  
  /** Dynamically discovered attachments */
  discovered_attachments: Attachment[];
  
  /** Last registry update timestamp */
  last_updated: number;
}

// ============================================================================
// Communication Protocol
// ============================================================================

/**
 * Base message structure (follows PathFinder events.py protocol)
 */
export interface BaseMessage<T = unknown> {
  /** Message type identifier */
  type: string;
  
  /** Timestamp (Unix epoch) */
  ts: number;
  
  /** Message payload */
  data: T;
}

/**
 * Outgoing mission start command
 */
export type MissionStartMessage = BaseMessage<{
  mission_id: string;
  start: Position;
  goal: Position;
  corridor?: {
    width_cm: number;
    height_cm: number;
  };
  parameters: MissionParameters;
}>;

/**
 * Incoming detection message from drone/attachment
 */
export type DetectionMessage = BaseMessage<DetectionEvent>;

/**
 * Drone status update message
 */
export type DroneStatusMessage = BaseMessage<{
  drone_id: string;
  position?: Position;
  battery?: number;
  status: string;
}>;

/**
 * Mission acknowledgment from drone
 */
export type MissionAckMessage = BaseMessage<{
  mission_id: string;
  drone_id: string;
  accepted: boolean;
  reason?: string;
}>;

/**
 * Union type for all message types
 */
export type Message = 
  | MissionStartMessage
  | DetectionMessage
  | DroneStatusMessage
  | MissionAckMessage;

/**
 * Communication protocol mode
 */
export type ProtocolMode = 'binary' | 'json';

/**
 * Communication transport configuration
 */
export interface TransportConfig {
  /** Transport type */
  type: 'serial' | 'lora' | 'satellite' | 'wifi' | 'test';
  
  /** Protocol mode */
  protocol: ProtocolMode;
  
  /** Transport-specific configuration */
  config: Record<string, unknown>;
  
  /** Retry strategy */
  retry?: {
    max_attempts: number;
    backoff_ms: number;
    timeout_ms: number;
  };
}
