/**
 * PathFinderService.ts
 * 
 * Integration layer for PathFinder Python service communication via Electron IPC.
 * PathFinder is a standalone Python application (PathFinder/main.py) that computes
 * safe navigation paths through minefields using A* pathfinding with obstacle avoidance.
 * 
 * ARCHITECTURE:
 * - Electron main process (main.js) spawns Python subprocess: "python PathFinder/main.py"
 * - This service sends mission data via IPC: renderer → main → Python stdin (JSONL)
 * - Python stdout events parsed by main process → returned to renderer as PathFinderRunResult
 * - Result contains waypoints array for safe path visualization on Grid.tsx
 * 
 * COMMUNICATION PROTOCOL:
 * 1. UI calls runSimulation(mission, aggregator) → serialize to PathFinderWorldExport JSON
 * 2. Send to main.js via window.electron.pathFinder.run(worldExport) IPC channel
 * 3. main.js spawns: python PathFinder/main.py --width=50 --height=30 --metres-per-cm=0.05
 * 4. main.js writes JSONL to Python stdin: '{"type":"world_data","ts":123.456,"data":{...}}\n'
 * 5. Python processes: builds graph, runs A*, computes safe waypoints
 * 6. Python writes JSONL to stdout: '{"type":"path_result","ts":123.789,"data":{waypoints:[...]}}\n'
 * 7. main.js parses stdout, returns events array to renderer
 * 8. UI displays waypoints on grid as blue path overlay
 * 
 * ERROR HANDLING:
 * - Python not installed → error: "Python executable not found"
 * - PathFinder/main.py missing → error: "PathFinder script not found at ..."
 * - Python syntax error → stderr captured in PathFinderRunResult.stderr
 * - No path exists (all routes blocked) → path_result with empty waypoints array
 * 
 * FILE EXPORT:
 * saveMissionExport() writes PathFinderWorldExport JSON to user's filesystem.
 * Useful for debugging, sharing mission data, or running PathFinder manually:
 * python PathFinder/main.py < mission_12345_export.json
 * 
 * COORDINATE SYSTEMS:
 * - Input: centimeter grid (x_cm, y_cm) matching internal Mission coordinate space
 * - PathFinder expects: same centimeter grid + metres_per_cm scale factor
 * - Output: waypoints in centimeter grid coordinates for Grid.tsx rendering
 */

import { MissionProtocolService } from './MissionProtocol';
import { DetectionAggregator } from './DetectionAggregator';
import type { Mission } from '../types/mission.types';

/**
 * Result structure returned from PathFinder subprocess execution.
 * success: true if Python process completed without errors
 * events: Parsed JSONL output (array of BaseMessage objects)
 * stdout/stderr: Raw process output for debugging
 * exitCode: 0 = success, non-zero = error
 */
export interface PathFinderRunResult {
  success: boolean;
  events?: unknown[];
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

/**
 * Static utility class for PathFinder integration.
 * Requires Electron environment (window.electron.pathFinder IPC bridge).
 */
export class PathFinderService {
  /**
   * Run PathFinder simulation with current mission and detection data.
   * Spawns Python subprocess via Electron main process, sends mission/minefield data,
   * receives computed safe path waypoints. Typical execution time: 100-500ms for
   * 50x30cm grid with <100 detections.
   * 
   * confidenceThreshold: Only include detections >= this confidence in minefield export.
   * Higher threshold = shorter paths (only avoid high-confidence mines),
   * lower threshold = more conservative paths (avoid uncertain detections).
   * 
   * Returns PathFinderRunResult with events array containing path_result message.
   * Check result.success before accessing result.events to extract waypoints.
   */
  static async runSimulation(
    mission: Mission,
    aggregator: DetectionAggregator,
    confidenceThreshold: number = 0.5
  ): Promise<PathFinderRunResult> {
    // Electron IPC bridge required (not available in pure web context)
    if (!window.electron) {
      throw new Error('PathFinder integration requires Electron environment');
    }

    // Convert mission + detections to PathFinder JSON format
    const worldExport = MissionProtocolService.exportForPathFinder(
      mission,
      aggregator,
      confidenceThreshold
    );

    // Send to main process → spawn Python → receive path result
    const result = await window.electron.pathFinder.run(worldExport);

    return result;
  }

  /**
   * Save mission export to file
   */
  static async saveMissionExport(
    mission: Mission,
    aggregator: DetectionAggregator,
    confidenceThreshold: number = 0.5
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!window.electron) {
      throw new Error('File save requires Electron environment');
    }

    const worldExport = MissionProtocolService.exportForPathFinder(
      mission,
      aggregator,
      confidenceThreshold
    );

    const content = MissionProtocolService.serializePathFinderExport(worldExport);
    const filename = `mission_${mission.mission_id}_export.json`;

    return await window.electron.file.save(filename, content);
  }

  /**
   * Get application paths
   */
  static async getAppPaths(): Promise<{
    userData: string;
    projectRoot: string;
    pathFinder: string;
  }> {
    if (!window.electron) {
      throw new Error('App paths require Electron environment');
    }

    return await window.electron.app.getPaths();
  }

  /**
   * Check if PathFinder is available
   */
  static isAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.electron;
  }
}
