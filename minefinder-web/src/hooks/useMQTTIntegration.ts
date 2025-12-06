/**
 * useMQTTIntegration Hook
 * 
 * Connects MQTT Client Service to application stores (MVVM integration layer).
 * Registers message handlers to update attachment, telemetry, and detection stores.
 * 
 * Architecture Pattern:
 * MQTT Service (Controller) → This Hook (ViewModel) → Stores (Model) → UI (View)
 * 
 * Usage:
 * Call once in App.tsx on mount to wire up MQTT → Store pipeline.
 */

import { useEffect } from 'react';
import { useMQTTStore } from '../stores/mqttStore';
import { useAttachmentStore } from '../stores/attachmentStore';
import { useTelemetryStore } from '../stores/telemetryStore';
import { useDetectionStore } from '../stores/detectionStore';
import type {
  AttachmentStatusMessage,
  TelemetryMessage,
  DetectionMessage,
  AttachmentHeartbeatMessage,
} from '../services/mqtt/types';

export function useMQTTIntegration() {
  const mqttStore = useMQTTStore();
  const attachmentStore = useAttachmentStore();
  const telemetryStore = useTelemetryStore();
  const detectionStore = useDetectionStore();

  useEffect(() => {
    const client = mqttStore.client;
    if (!client || !mqttStore.connected) {
      console.log('[useMQTTIntegration] MQTT not connected, skipping handlers');
      return;
    }

    console.log('[useMQTTIntegration] Registering MQTT message handlers');

    // Attachment Status Handler (discovery)
    client.onAttachmentStatus((status: AttachmentStatusMessage) => {
      console.log('[MQTT→Store] Attachment status:', status);
      
      // Map MQTT attachment to registry format
      const attachment: any = {
        id: status.attachment_id,
        name: status.attachment_name,
        type: 'multi_sensor', // Default type, could be in capabilities
        status: status.online ? 'online' : 'offline',
        transport: { type: 'mqtt', config: {} },
        last_seen: status.ts,
        battery_level: 100, // Not in MQTT message yet
      };
      
      attachmentStore.discoverAttachment(attachment);
    });

    // Heartbeat Handler
    client.onAttachmentHeartbeat((heartbeat: AttachmentHeartbeatMessage) => {
      attachmentStore.updateLastSeen(heartbeat.attachment_id, heartbeat.ts);
    });

    // Telemetry Handler
    client.onTelemetry((telemetry: TelemetryMessage) => {
      // Map to TelemetryFrame format expected by telemetryStore
      telemetryStore.ingestTelemetry({
        pos_gps: {
          latitude: telemetry.position.lat,
          longitude: telemetry.position.lon,
        },
        speed_ms: 0, // TODO: Add to telemetry message
        ts: telemetry.ts,
      });
    });

    // Detection Handler
    client.onDetection((detection: DetectionMessage) => {
      // Map to DetectionEvent format expected by detectionStore
      detectionStore.processDetection({
        position: {
          x_cm: 0, // TODO: Convert lat/lon to grid coordinates
          y_cm: 0,
          x_m: 0,
          y_m: 0,
          gps: {
            latitude: detection.position.lat,
            longitude: detection.position.lon,
          },
        },
        confidence: detection.confidence,
        sensor_id: detection.sensor_id,
        timestamp: detection.ts,
      });
    });

    // Periodic heartbeat checker (every 5 seconds)
    const heartbeatInterval = setInterval(() => {
      attachmentStore.pruneStaleAttachments(15000); // 15 second timeout
    }, 5000);

    return () => {
      clearInterval(heartbeatInterval);
      console.log('[useMQTTIntegration] Cleanup');
    };
  }, [mqttStore.connected, mqttStore.client]);

  return {
    connected: mqttStore.connected,
    connecting: mqttStore.connecting,
    error: mqttStore.error,
  };
}
