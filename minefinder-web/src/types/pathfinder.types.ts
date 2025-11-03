/**
 * PathFinder integration types
 * Defines data exchange format with PathFinder simulation
 */

import type { Position } from './mission.types';

/**
 * PathFinder simulation configuration
 * Maps to PathFinder's Config model
 */
export interface PathFinderConfig {
  width_cm: number;
  height_cm: number;
  metres_per_cm: number;
}

/**
 * PathFinder world state export
 * Data structure for feeding detected mines into PathFinder simulation
 */
export interface PathFinderWorldExport {
  /** World/grid configuration */
  config: PathFinderConfig;
  
  /** All detected mine positions */
  mines: Position[];
  
  /** Starting position (drone initial position) */
  start: Position;
  
  /** Goal position (destination) */
  goal: Position;
  
  /** Mission metadata */
  metadata: {
    mission_id: string;
    created_at: number;
    total_detections: number;
  };
}

/**
 * PathFinder safe path result
 * Returned after PathFinder calculates safe route
 */
export interface PathFinderResult {
  /** Mission identifier */
  mission_id: string;
  
  /** Calculated waypoints for safe path */
  waypoints: Position[];
  
  /** Total path length in meters */
  path_length_m: number;
  
  /** Whether a valid path was found */
  path_found: boolean;
  
  /** Calculation metadata */
  metadata: {
    algorithm: string;
    computation_time_ms: number;
    calculated_at: number;
  };
}

/**
 * PathFinder event types (from events.py)
 */
export type PathFinderEventType =
  | 'app_start'
  | 'drone_move'
  | 'drone_scan'
  | 'cell_mine_set'
  | 'cell_mine_unset'
  | 'goal_set'
  | 'key_command';

/**
 * Generic PathFinder event structure
 */
export interface PathFinderEvent<T = unknown> {
  type: PathFinderEventType;
  ts: number;
  data: T;
}
