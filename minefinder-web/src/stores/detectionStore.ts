/**
 * Detection Store
 * 
 * Zustand state management for mine detection aggregation and statistics.
 * Wraps DetectionAggregator service to provide reactive state updates
 * when new detections arrive from hardware sensors.
 * 
 * Deduplication Strategy:
 * Multiple sensors may detect the same mine. Store maintains only one
 * aggregated detection per grid cell, keeping the highest confidence value.
 * 
 * Real-time Updates:
 * Detection events from comms adapter are processed immediately, triggering
 * UI updates via React component subscriptions to this store.
 */

import { create } from 'zustand';
import type { DetectionEvent, AggregatedDetection } from '../types/mission.types';
import { DetectionAggregator } from '../services/DetectionAggregator';

/**
 * Detection store state and actions interface
 */
interface DetectionState {
  // Core aggregation service instance
  aggregator: DetectionAggregator;
  
  // Reactive detection array for UI rendering
  detections: AggregatedDetection[];
  
  // Computed statistics for dashboard display
  stats: {
    total_detections: number;         // Total detection events received
    unique_positions: number;         // Distinct grid cells with detections
    avg_confidence: number;           // Mean confidence across all detections
    sensors_contributing: Set<string>; // Unique sensor IDs reporting detections
  } | null;
  
  // Store actions
  processDetection: (event: DetectionEvent) => void;  // Add new detection from hardware
  clearDetections: () => void;                        // Reset for new mission
  updateStats: () => void;                            // Recalculate statistics
  getDetections: () => AggregatedDetection[];         // Get all detections
  getDetectionsAboveConfidence: (threshold: number) => AggregatedDetection[];  // Filter by confidence
}

export const useDetectionStore = create<DetectionState>((set, get) => ({
  aggregator: new DetectionAggregator({ min_confidence: 0.3 }),
  detections: [],
  stats: null,

  processDetection: (event) => {
    const aggregator = get().aggregator;
    const result = aggregator.processDetection(event);
    
    if (result) {
      // Update reactive state
      set({
        detections: aggregator.getAllDetections(),
      });
      
      // Update stats
      get().updateStats();
    }
  },

  clearDetections: () => {
    const aggregator = get().aggregator;
    aggregator.clear();
    set({ detections: [], stats: null });
  },

  updateStats: () => {
    const aggregator = get().aggregator;
    set({ stats: aggregator.getStats() });
  },

  getDetections: () => {
    return get().detections;
  },

  getDetectionsAboveConfidence: (threshold) => {
    return get().aggregator.getDetectionsAboveConfidence(threshold);
  },
}));
