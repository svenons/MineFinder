/**
 * MQTT message types for MineFinder system
 */

export interface MessageEnvelope<T = any> {
  msg_id: string;
  ts: number;
  correlation_id?: string;
  payload: T;
}

export interface AttachmentStatusMessage {
  online: boolean;
  mode: 'simulator' | 'real';
  attachment_id: string;
  attachment_name: string;
  capabilities: string[];
  ts: number;
}

export interface AttachmentHeartbeatMessage {
  ts: number;
  attachment_id: string;
}

export interface TelemetryMessage {
  ts: number;
  position: {
    lat: number;
    lon: number;
    alt_m: number;
  };
  battery: {
    voltage: number;
    current: number;
    level: number;
  };
  state: 'idle' | 'scanning' | 'returning' | 'avoiding';
  progress?: number;
  cells_scanned?: number;
  total_cells?: number;
  mines_detected?: number;
}

export interface DetectionMessage {
  ts: number;
  position: {
    lat: number;
    lon: number;
    alt_m: number;
  };
  result: 'mine' | 'clear';
  confidence: number;
  sensor_id: string;
  image_ref?: string;
}

export interface MissionStartCommand {
  type: 'mission_start';
  mission_id: string;
  start: {
    lat: number;
    lon: number;
  };
  goal: {
    lat: number;
    lon: number;
  };
  parameters: {
    altitude_m: number;
    grid_size_m: number;
    corridor_width_m: number;
    speed_ms: number;
    confidence_threshold: number;
    num_lines?: number;
  };
}

export interface MissionStopCommand {
  type: 'mission_stop';
  mission_id: string;
}

export interface CommandAckMessage {
  correlation_id: string;
  success: boolean;
  error?: string;
  ts: number;
}
