/**
 * MissionProtocol.ts
 * 
 * Message protocol service for hardware communication and PathFinder integration.
 * Handles serialization/deserialization of mission control messages between the
 * Electron UI and hardware attachments (drones, sensors) or the PathFinder Python
 * service for safe path computation.
 * 
 * PROTOCOL FORMAT:
 * All messages follow this JSON structure:
 * {
 *   "type": "mission_start" | "drone_scan" | "path_result" | ...,
 *   "ts": 1234567890.123,  // Unix timestamp in seconds (PathFinder compatible)
 *   "data": { ... }         // Message-specific payload
 * }
 * 
 * MESSAGE TYPES:
 * - mission_start: UI → Hardware. Sends mission_id, start, goal, corridor, parameters
 * - drone_scan: Hardware → UI. Detection event with position, confidence, sensor_id
 * - path_result: PathFinder → UI. Safe path waypoints avoiding detected mines
 * 
 * PATHFINDER INTEGRATION:
 * PathFinder is a Python service that computes safe paths through minefields.
 * Two communication methods supported:
 * 1. REST API: POST /compute-path with PathFinderWorldExport JSON body
 * 2. JSONL stdin/stdout: Each message is JSON object followed by newline
 * 
 * DATA FLOW:
 * 1. Mission created → createMissionStartMessage() → serialize to JSON
 * 2. Send to BaseCommsAdapter → hardware receives mission parameters
 * 3. Hardware detects mine → DetectionMessage → parseDetectionMessage() → DetectionEvent
 * 4. DetectionAggregator accumulates detections
 * 5. User requests path → exportForPathFinder() → PathFinderWorldExport JSON
 * 6. POST to PathFinder API → PathFinderResult JSON → parsePathFinderResult()
 * 7. Display waypoints on Grid.tsx as safe navigation route
 * 
 * COORDINATE SYSTEMS:
 * - Internal grid: centimeters (x_cm, y_cm) relative to reference point
 * - PathFinder expects: same centimeter grid
 * - Hardware sensors report: centimeters
 * - UI displays: meters for readability, GPS coords via CoordinateService
 */

import type {
  Mission,
  MissionStartMessage,
  DetectionMessage,
  DetectionEvent,
  BaseMessage,
} from '../types/mission.types';

import type {
  PathFinderWorldExport,
  PathFinderResult,
} from '../types/pathfinder.types';

import { DetectionAggregator } from './DetectionAggregator';

/**
 * Static utility class for protocol message handling.
 * All methods are stateless; no instance required.
 */
export class MissionProtocolService {
  /**
   * Create mission start message for transmission to hardware attachments.
   * Serializes Mission object into protocol format for BaseCommsAdapter transmission.
   * Hardware uses this to initialize navigation parameters (start/goal positions,
   * corridor boundaries, scan patterns, speed limits).
   */
  static createMissionStartMessage(mission: Mission): MissionStartMessage {
    return {
      type: 'mission_start',
      ts: Date.now() / 1000, // Unix seconds (PathFinder compatibility)
      data: {
        mission_id: mission.mission_id,
        start: mission.start,
        goal: mission.goal,
        corridor: mission.corridor,
        parameters: mission.parameters,
      },
    };
  }

  /**
   * Parse incoming detection message from drone
   */
  static parseDetectionMessage(message: DetectionMessage): DetectionEvent {
    return message.data;
  }

  /**
   * Create detection message (for testing/simulation)
   */
  static createDetectionMessage(event: DetectionEvent): DetectionMessage {
    return {
      type: 'drone_scan',
      ts: event.timestamp,
      data: event,
    };
  }

  /**
   * Validate incoming message structure
   */
  static isValidMessage(message: unknown): message is BaseMessage {
    if (typeof message !== 'object' || message === null) {
      return false;
    }

    const msg = message as Record<string, unknown>;
    return (
      typeof msg.type === 'string' &&
      typeof msg.ts === 'number' &&
      msg.data !== undefined
    );
  }

  /**
   * Export mission data for PathFinder API.
   * Converts current mission state and aggregated detections into PathFinderWorldExport
   * format expected by POST /compute-path endpoint. PathFinder uses this to build
   * a spatial graph of the minefield and compute A* path avoiding detected mines.
   * 
   * confidenceThreshold: Only export detections with confidence >= this value.
   * Lower threshold = more conservative paths (avoid uncertain detections),
   * higher threshold = shorter paths (only avoid high-confidence mines).
   */
  static exportForPathFinder(
    mission: Mission,
    aggregator: DetectionAggregator,
    confidenceThreshold: number = 0.5
  ): PathFinderWorldExport {
    const mines = aggregator.exportForPathFinder(confidenceThreshold);

    return {
      config: {
        width_cm: mission.corridor?.width_cm || 50,
        height_cm: mission.corridor?.height_cm || 30,
        metres_per_cm: mission.metres_per_cm,
      },
      mines,
      start: mission.start,
      goal: mission.goal,
      metadata: {
        mission_id: mission.mission_id,
        created_at: mission.created_at,
        total_detections: aggregator.getDetectionCount(),
      },
    };
  }

  /**
   * Serialize PathFinder export to JSON string
   */
  static serializePathFinderExport(data: PathFinderWorldExport): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Parse PathFinder result from JSON
   */
  static parsePathFinderResult(json: string): PathFinderResult {
    return JSON.parse(json) as PathFinderResult;
  }

  /**
   * Create PathFinder event in JSONL format (for stdin communication).
   * JSONL = JSON Lines = one JSON object per line, newline-delimited.
   * Used when communicating with PathFinder via stdin/stdout instead of HTTP API.
   * Follows events.py protocol: each message is complete JSON object + '\n'.
   * Example: echo '{"type":"compute_path","ts":123.456,"data":{...}}\n' | python main.py
   */
  static createPathFinderEvent<T>(
    type: string,
    data: T
  ): string {
    const event = {
      type,
      ts: Date.now() / 1000,
      data,
    };
    return JSON.stringify(event) + '\n'; // Newline required for JSONL
  }

  /**
   * Parse JSONL stream from PathFinder.
   * Splits by newline, filters empty lines, parses each line as JSON.
   * Used to process PathFinder stdout when using stdin/stdout communication.
   */
  static parsePathFinderEvents(jsonlStream: string): BaseMessage[] {
    return jsonlStream
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as BaseMessage);
  }

  /**
   * Generate mission ID
   */
  static generateMissionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `mission_${timestamp}_${random}`;
  }

  /**
   * Convert mission to command-line arguments for PathFinder
   */
  static toPathFinderArgs(mission: Mission): string[] {
    const args: string[] = [];

    if (mission.corridor) {
      args.push(`--width=${mission.corridor.width_cm}`);
      args.push(`--height=${mission.corridor.height_cm}`);
    }

    args.push(`--metres-per-cm=${mission.metres_per_cm}`);

    return args;
  }
}
