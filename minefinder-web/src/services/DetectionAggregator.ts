/**
 * DetectionAggregator.ts
 * 
 * Real-time mine detection aggregation service with spatial de-duplication.
 * Multiple sensors may detect the same mine at slightly different times with
 * varying confidence levels. This service merges detections at identical grid
 * positions while tracking confidence evolution and sensor contributions.
 * 
 * KEY CONCEPTS:
 * - Position Key: String format "x_cm_y_cm" used as Map key for O(1) lookup
 * - Aggregation: Each grid cell (x_cm, y_cm) gets one AggregatedDetection tracking
 *   all DetectionEvents at that position
 * - Confidence Merging: When multiple detections occur at same position, the highest
 *   confidence value becomes the aggregated confidence
 * - Primary Sensor: The sensor_id that reported the highest confidence becomes
 *   the primary_sensor_id for display purposes
 * 
 * DATA FLOW:
 * 1. Hardware sensor → DetectionEvent (via BaseCommsAdapter) → processDetection()
 * 2. Check if position already has detection (Map lookup by position_key)
 * 3. If exists: update confidence, append to history
 * 4. If new: create AggregatedDetection, store in Map
 * 5. detectionStore reads via getAllDetections() for UI display
 * 6. PathFinderService reads via exportForPathFinder() for safe path computation
 * 
 * PERFORMANCE:
 * - O(1) detection lookup/update using Map with position_key
 * - pruneOldDetections() runs periodically to prevent unbounded memory growth
 * - Statistics computation iterates all detections (acceptable for <10,000 detections)
 */

import type { 
  DetectionEvent, 
  AggregatedDetection, 
  Position 
} from '../types/mission.types';

/**
 * Configuration for detection aggregation behavior
 */
export interface AggregatorConfig {
  /** Minimum confidence threshold to store a detection (0-1). Detections below
   * this value are discarded immediately. Set to 0.0 to keep all detections. */
  min_confidence: number;
  
  /** Maximum age of detections to keep in memory (milliseconds). If set,
   * pruneOldDetections() will remove detections older than this threshold.
   * Useful for live missions to prevent stale data accumulation. */
  max_age_ms?: number;
}

/**
 * Manages mine detection aggregation with de-duplication
 */
export class DetectionAggregator {
  /** Map of position_key -> AggregatedDetection */
  private detections: Map<string, AggregatedDetection>;
  
  private config: AggregatorConfig;

  constructor(config: AggregatorConfig = { min_confidence: 0.0 }) {
    this.detections = new Map();
    this.config = config;
  }

  /**
   * Generate position key for coordinate-based lookup
   * Format: "x_cm_y_cm" (e.g., "15_23")
   */
  private static getPositionKey(position: Position): string {
    return `${position.x_cm}_${position.y_cm}`;
  }

  /**
   * Process incoming detection event
   * Returns the aggregated detection (new or updated)
   */
  processDetection(event: DetectionEvent): AggregatedDetection | null {
    // Filter out low-confidence detections
    if (event.confidence < this.config.min_confidence) {
      return null;
    }

    const posKey = DetectionAggregator.getPositionKey(event.position);
    const existing = this.detections.get(posKey);

    if (existing) {
      // Update existing detection
      return this.updateExistingDetection(existing, event);
    } else {
      // Create new aggregated detection
      return this.createNewDetection(posKey, event);
    }
  }

  /**
   * Update an existing aggregated detection with new event.
   * Appends event to detection history and updates confidence if higher.
   * The primary_sensor_id changes only when a sensor reports higher confidence
   * than the current maximum (handles sensor recalibration or multi-pass scans).
   */
  private updateExistingDetection(
    existing: AggregatedDetection, 
    event: DetectionEvent
  ): AggregatedDetection {
    // Append to historical record (preserves all sensor contributions)
    existing.detections.push(event);
    existing.last_updated = event.timestamp;

    // Confidence upgrade: new detection has higher confidence than current max
    if (event.confidence > existing.confidence) {
      existing.confidence = event.confidence;
      existing.primary_sensor_id = event.sensor_id;
    }

    this.detections.set(existing.position_key, existing);
    return existing;
  }

  /**
   * Create new aggregated detection from first event
   */
  private createNewDetection(
    posKey: string, 
    event: DetectionEvent
  ): AggregatedDetection {
    const aggregated: AggregatedDetection = {
      position_key: posKey,
      position: event.position,
      confidence: event.confidence,
      primary_sensor_id: event.sensor_id,
      detections: [event],
      first_detected: event.timestamp,
      last_updated: event.timestamp,
    };

    this.detections.set(posKey, aggregated);
    return aggregated;
  }

  /**
   * Get all aggregated detections
   */
  getAllDetections(): AggregatedDetection[] {
    return Array.from(this.detections.values());
  }

  /**
   * Get detection at specific position
   */
  getDetectionAt(position: Position): AggregatedDetection | undefined {
    const key = DetectionAggregator.getPositionKey(position);
    return this.detections.get(key);
  }

  /**
   * Get detections above confidence threshold
   */
  getDetectionsAboveConfidence(threshold: number): AggregatedDetection[] {
    return this.getAllDetections().filter(d => d.confidence >= threshold);
  }

  /**
   * Get count of unique mine locations
   */
  getDetectionCount(): number {
    return this.detections.size;
  }

  /**
   * Clear all detections
   */
  clear(): void {
    this.detections.clear();
  }

  /**
   * Remove detections older than max_age_ms.
   * Prevents unbounded memory growth in long-running missions by deleting
   * detections that haven't been updated recently. Should be called periodically
   * (e.g., every 60 seconds) via setInterval in App.tsx.
   * Returns count of pruned detections for logging/monitoring.
   */
  pruneOldDetections(): number {
    if (!this.config.max_age_ms) {
      return 0;
    }

    const now = Date.now();
    const cutoff = now - this.config.max_age_ms;
    let pruned = 0;

    // Iterate all detections and delete those not updated since cutoff
    for (const [key, detection] of this.detections.entries()) {
      if (detection.last_updated < cutoff) {
        this.detections.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Export detections for PathFinder simulation.
   * Returns array of Position objects representing mine locations above the
   * specified confidence threshold. PathFinderService uses this to compute
   * safe paths that avoid detected mines. Lower threshold = more conservative
   * paths (avoid uncertain detections), higher threshold = shorter paths (only
   * avoid high-confidence mines).
   */
  exportForPathFinder(confidenceThreshold: number = 0.5): Position[] {
    return this.getDetectionsAboveConfidence(confidenceThreshold)
      .map(d => d.position);
  }

  /**
   * Get statistics about current detections
   */
  getStats(): {
    total_detections: number;
    unique_positions: number;
    avg_confidence: number;
    sensors_contributing: Set<string>;
  } {
    const detections = this.getAllDetections();
    const sensors = new Set<string>();
    let totalConfidence = 0;

    for (const detection of detections) {
      totalConfidence += detection.confidence;
      for (const event of detection.detections) {
        sensors.add(event.sensor_id);
      }
    }

    return {
      total_detections: detections.reduce((sum, d) => sum + d.detections.length, 0),
      unique_positions: detections.length,
      avg_confidence: detections.length > 0 ? totalConfidence / detections.length : 0,
      sensors_contributing: sensors,
    };
  }
}
