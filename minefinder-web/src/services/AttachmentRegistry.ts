/**
 * AttachmentRegistry.ts
 * 
 * Central registry for hardware sensor attachments (drones, GPR sensors, metal detectors).
 * Manages both pre-configured attachments (attachments.json) and dynamically discovered
 * attachments that connect at runtime via BaseCommsAdapter.
 * 
 * ATTACHMENT LIFECYCLE:
 * 1. Known Attachments: Pre-configured in attachments.json, loaded at startup
 *    - Example: "GPR-Alpha" metal detector with known IP/port
 *    - Initial status: 'offline' (hardware not yet connected)
 * 2. Discovered Attachments: Unknown hardware that announces itself via heartbeat
 *    - Example: New drone connects, sends {"type":"heartbeat","data":{id:"DRONE-9", ...}}
 *    - Added to discovered_attachments array, status: 'online'
 * 3. Heartbeat Tracking: BaseCommsAdapter updates last_seen timestamp on each heartbeat
 * 4. Pruning: pruneStaleAttachments() marks attachments as 'offline' if no heartbeat
 *    received within timeout (default 60 seconds)
 * 
 * ATTACHMENT TYPES:
 * - gpr_alpha: Ground Penetrating Radar (metal detector)
 * - ir_camera: Infrared thermal imaging (detects buried objects by heat signature)
 * - magnetometer: Magnetic field sensor (detects ferrous metal)
 * - drone: Aerial platform carrying sensors
 * 
 * STATUS VALUES:
 * - online: Heartbeat received recently, ready for mission assignment
 * - offline: No recent heartbeat or explicit disconnect
 * - busy: Currently assigned to active mission
 * - error: Hardware reported error condition (low battery, sensor failure, etc.)
 * 
 * DATA FLOW:
 * 1. App.tsx creates AttachmentRegistryService instance
 * 2. BaseCommsAdapter receives heartbeat → calls registryService.updateLastSeen(id)
 * 3. attachmentStore.ts reads via registryService.getAllAttachments() for UI display
 * 4. AttachmentSelector.tsx filters getOnlineAttachments() for mission selection
 * 5. Periodic pruneStaleAttachments() in App.tsx marks unresponsive hardware offline
 * 
 * PERSISTENCE:
 * Currently in-memory only. On app restart, discovered_attachments are lost and
 * hardware must re-announce via heartbeat. Future: exportRegistry() → localStorage
 * or filesystem persistence.
 */

import type { Attachment, AttachmentRegistry } from '../types/mission.types';
import attachmentsConfig from '../config/attachments.json';

/**
 * Stateful service managing hardware attachment registry.
 * Single instance created in App.tsx, shared via props to child components.
 */
export class AttachmentRegistryService {
  private registry: AttachmentRegistry;

  constructor() {
    // Initialize with static configuration from attachments.json
    this.registry = {
      known_attachments: attachmentsConfig.known_attachments as Attachment[],
      discovered_attachments: attachmentsConfig.discovered_attachments as Attachment[],
      last_updated: Date.now(),
    };
  }

  /**
   * Get all attachments (known + discovered)
   */
  getAllAttachments(): Attachment[] {
    return [
      ...this.registry.known_attachments,
      ...this.registry.discovered_attachments,
    ];
  }

  /**
   * Get attachment by ID
   */
  getAttachment(id: string): Attachment | undefined {
    return this.getAllAttachments().find(a => a.id === id);
  }

  /**
   * Get only online attachments
   */
  getOnlineAttachments(): Attachment[] {
    return this.getAllAttachments().filter(a => a.status === 'online');
  }

  /**
   * Add newly discovered attachment
   */
  discoverAttachment(attachment: Attachment): void {
    // Check if already exists
    const existing = this.getAttachment(attachment.id);
    if (existing) {
      // Update existing attachment
      this.updateAttachment(attachment.id, attachment);
      return;
    }

    // Add to discovered list
    this.registry.discovered_attachments.push(attachment);
    this.registry.last_updated = Date.now();
  }

  /**
   * Update attachment status and metadata
   */
  updateAttachment(id: string, updates: Partial<Attachment>): boolean {
    const attachment = this.getAttachment(id);
    if (!attachment) {
      return false;
    }

    Object.assign(attachment, updates);
    this.registry.last_updated = Date.now();
    return true;
  }

  /**
   * Update attachment status by ID
   */
  updateStatus(id: string, status: Attachment['status']): boolean {
    return this.updateAttachment(id, { status });
  }

  /**
   * Update last_seen timestamp for an attachment
   */
  updateLastSeen(id: string, timestamp: number = Date.now()): boolean {
    const attachment = this.getAttachment(id);
    if (!attachment) {
      return false;
    }

    attachment.comm.last_seen = timestamp;
    this.registry.last_updated = Date.now();
    return true;
  }

  /**
   * Mark attachments as offline if not seen within timeout.
   * Should be called periodically (e.g., every 30 seconds via setInterval) to detect
   * hardware disconnections. Attachments transition 'online' → 'offline' if no heartbeat
   * received within timeoutMs. Returns count of attachments marked offline for logging.
   * 
   * Typical timeout values:
   * - 60000ms (60s): Default, tolerates occasional network hiccups
   * - 30000ms (30s): Aggressive, faster detection of hardware failures
   * - 120000ms (120s): Conservative, useful for unreliable networks
   */
  pruneStaleAttachments(timeoutMs: number = 60000): number {
    const now = Date.now();
    const cutoff = now - timeoutMs;
    let updated = 0;

    // Check all attachments for stale last_seen timestamps
    for (const attachment of this.getAllAttachments()) {
      if (
        attachment.comm.last_seen < cutoff && 
        attachment.status !== 'offline'
      ) {
        attachment.status = 'offline';
        updated++;
      }
    }

    if (updated > 0) {
      this.registry.last_updated = now;
    }

    return updated;
  }

  /**
   * Export registry to JSON (for persistence)
   */
  exportRegistry(): AttachmentRegistry {
    return JSON.parse(JSON.stringify(this.registry));
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total: number;
    known: number;
    discovered: number;
    online: number;
    by_type: Record<string, number>;
  } {
    const all = this.getAllAttachments();
    const byType: Record<string, number> = {};

    for (const attachment of all) {
      byType[attachment.type] = (byType[attachment.type] || 0) + 1;
    }

    return {
      total: all.length,
      known: this.registry.known_attachments.length,
      discovered: this.registry.discovered_attachments.length,
      online: all.filter(a => a.status === 'online').length,
      by_type: byType,
    };
  }
}
