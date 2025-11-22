// Pi protocol types (JSONL v1)
export interface GPSPoint { lat: number; lon: number; alt?: number }

export interface IdentifyMsg {
  type: 'identify';
  version: number;
  server: string;
  attachment_id: string;
  attachment_name: string;
  controllers: { id: string; name: string; capabilities: string[] }[];
  selected_controller?: string;
  mission_active?: boolean;
  configured?: boolean;
}

export interface ControllerListMsg {
  type: 'controller_list';
  controllers: { id: string; name: string; capabilities: string[] }[];
}

export interface ControllerSelectedMsg { type: 'controller_selected'; id: string }
export interface ConfiguredMsg { type: 'configured'; ok: boolean }
export interface StatusMsg { type: 'status'; message: string }
export interface ErrorMsg { type: 'error'; code?: string | number; message: string }

export interface PathUpdateMsg {
  type: 'path_update';
  waypoints_gps: GPSPoint[];
  reason?: 'initial' | 'replan';
}

export interface TelemetryMsg {
  type: 'telemetry';
  pos_gps: GPSPoint;
  path_travelled_gps?: GPSPoint[];
  path_active_gps?: GPSPoint[];
  speed_ms?: number;
  ts?: number;
}

export interface NavDoneMsg { type: 'nav_done' }

export interface HeartbeatMsg {
  type: 'heartbeat';
  attachment_id: string;
  selected_controller?: string;
  mission_active: boolean;
}

export interface StateResponseMsg {
  type: 'state_response';
  attachment_id: string;
  attachment_name: string;
  selected_controller?: string;
  mission_active: boolean;
  configured: boolean;
  origin_gps?: { lat: number; lon: number; alt?: number };
  metres_per_cm?: number;
  simulate?: boolean;
}

export type InboundMsg =
  | IdentifyMsg
  | ControllerListMsg
  | ControllerSelectedMsg
  | ConfiguredMsg
  | StatusMsg
  | ErrorMsg
  | PathUpdateMsg
  | TelemetryMsg
  | NavDoneMsg
  | HeartbeatMsg
  | StateResponseMsg;

export type OutboundMsg =
  | { type: 'hello'; role: 'client'; app: string; version: number }
  | { type: 'select_controller'; id: string }
  | { type: 'configure'; origin_gps: { lat: number; lon: number; alt?: number }; metres_per_cm: number; simulate: boolean; simulated_speed_ms?: number; mine_buffer_m?: number; telemetry_hz?: number }
  | { type: 'sim_mines'; mines_gps: { lat: number; lon: number; radius_m?: number }[] }
  | { type: 'mission_start'; start_gps: GPSPoint; goal_gps: GPSPoint }
  | { type: 'mission_stop' }
  | { type: 'query_state' };
