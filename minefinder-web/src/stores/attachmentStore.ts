/**
 * Attachment Store
 * 
 * Zustand state management for hardware sensor attachment registry.
 * Tracks known and discovered attachments, manages selection state
 * for mission assignment, and monitors attachment health/connectivity.
 * 
 * Attachment Types:
 * - Known: Pre-configured in attachments.json
 * - Discovered: Dynamically detected via hardware discovery protocols
 * 
 * Status Tracking:
 * Store polls registry periodically to update attachment status,
 * last_seen timestamps, and battery levels. Stale attachments
 * (no heartbeat for 60s) are pruned automatically.
 */

import { create } from 'zustand';
import type { Attachment } from '../types/mission.types';
import { AttachmentRegistryService } from '../services/AttachmentRegistry';

/**
 * Attachment store state and actions interface
 */
interface AttachmentState {
  // Core registry service instance
  registry: AttachmentRegistryService;
  
  // Reactive attachment lists for UI rendering
  attachments: Attachment[];              // All known and discovered attachments
  onlineAttachments: Attachment[];        // Only attachments with 'online' status
  
  // Mission assignment tracking
  selectedAttachmentIds: Set<string>;     // IDs of attachments selected for current mission
  
  // Computed statistics for dashboard
  stats: {
    total: number;                        // Total attachment count
    known: number;                        // Pre-configured attachments
    discovered: number;                   // Dynamically found attachments
    online: number;                       // Currently connected attachments
    by_type: Record<string, number>;      // Count per sensor type
  } | null;
  
  // Store actions
  refreshAttachments: () => void;                                     // Reload from registry
  selectAttachment: (id: string) => void;                             // Add to mission
  deselectAttachment: (id: string) => void;                           // Remove from mission
  toggleAttachment: (id: string) => void;                             // Toggle selection
  clearSelection: () => void;                                         // Deselect all
  
  updateAttachmentStatus: (id: string, status: Attachment['status']) => void;  // Update operational state
  updateLastSeen: (id: string, timestamp?: number) => void;           // Update heartbeat timestamp
  discoverAttachment: (attachment: Attachment) => void;               // Register new hardware
  
  pruneStaleAttachments: (timeoutMs?: number) => void;                // Remove unresponsive attachments
  updateStats: () => void;                                            // Recalculate statistics
}

export const useAttachmentStore = create<AttachmentState>((set, get) => ({
  registry: new AttachmentRegistryService(),
  attachments: [],
  onlineAttachments: [],
  selectedAttachmentIds: new Set(),
  stats: null,

  refreshAttachments: () => {
    const registry = get().registry;
    set({
      attachments: registry.getAllAttachments(),
      onlineAttachments: registry.getOnlineAttachments(),
    });
    get().updateStats();
  },

  selectAttachment: (id) => {
    set((state) => ({
      selectedAttachmentIds: new Set([...state.selectedAttachmentIds, id]),
    }));
  },

  deselectAttachment: (id) => {
    set((state) => {
      const newSet = new Set(state.selectedAttachmentIds);
      newSet.delete(id);
      return { selectedAttachmentIds: newSet };
    });
  },

  toggleAttachment: (id) => {
    const selected = get().selectedAttachmentIds;
    if (selected.has(id)) {
      get().deselectAttachment(id);
    } else {
      get().selectAttachment(id);
    }
  },

  clearSelection: () => {
    set({ selectedAttachmentIds: new Set() });
  },

  updateAttachmentStatus: (id, status) => {
    const registry = get().registry;
    registry.updateStatus(id, status);
    get().refreshAttachments();
  },

  updateLastSeen: (id, timestamp) => {
    const registry = get().registry;
    registry.updateLastSeen(id, timestamp);
    get().refreshAttachments();
  },

  discoverAttachment: (attachment) => {
    const registry = get().registry;
    registry.discoverAttachment(attachment);
    get().refreshAttachments();
  },

  pruneStaleAttachments: (timeoutMs) => {
    const registry = get().registry;
    registry.pruneStaleAttachments(timeoutMs);
    get().refreshAttachments();
  },

  updateStats: () => {
    const registry = get().registry;
    set({ stats: registry.getStats() });
  },
}));

// Initialize attachments on store creation
useAttachmentStore.getState().refreshAttachments();
