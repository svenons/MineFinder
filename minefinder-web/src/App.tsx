/**
 * Main Application Component
 * 
 * Root component orchestrating the Mission Controller interface.
 * Manages application-level state, MQTT connection lifecycle,
 * and coordinates interaction between mission planning, detection
 * aggregation, and hardware communication subsystems.
 * 
 * Architecture:
 * - Left sidebar: Mission configuration and attachment selection
 * - Top bar: Active mission dashboard and controls
 * - Center: Interactive grid with satellite imagery and detections
 * - Bottom bar: Status indicators and grid metadata
 * 
 * State Flow:
 * Hardware → MQTT → Stores → UI
 */

import { useState, useEffect, useCallback } from 'react';
import './App.css';

// Components
import { Grid } from './components/Grid';
import { MissionForm } from './components/MissionForm';
import { AttachmentSelector } from './components/AttachmentSelector';
import { MissionDashboard } from './components/MissionDashboard';

// Stores (Zustand state management)
import { useMissionStore } from './stores/missionStore';
import { useDetectionStore } from './stores/detectionStore';
import { useAttachmentStore } from './stores/attachmentStore';
import { useMQTTStore } from './stores/mqttStore';

// Services
import { mqttService } from './services/mqtt/MQTTClientService';
import { PathFinderService } from './services/PathFinderService';
import type { Attachment } from './types/mission.types';

function App() {
  // Mission state management via Zustand stores
  const {
    activeMission,      // Currently executing mission or null
    draftStart,         // Draft start position before mission creation
    draftGoal,          // Draft goal position before mission creation
    setDraftStart,
    setDraftGoal,
    clearDraft,
    createMission,      // Creates mission from draft positions
    startMission,       // Transitions mission to active state
    completeMission,    // Marks mission as completed
    abortMission,       // Emergency mission termination
  } = useMissionStore();

  // Detection aggregation and deduplication
  const { detections, processDetection, clearDetections } = useDetectionStore();

  // Hardware attachment registry and selection
  const {
    attachments,
    selectedAttachmentIds,
    toggleAttachment,
    clearSelection,
    discoverAttachment,
  } = useAttachmentStore();

  // MQTT connection state
  const { connected: isConnected, connect: mqttConnect, disconnect: mqttDisconnect } = useMQTTStore();

  // Local UI state
  const [clickMode, setClickMode] = useState<'start' | 'goal'>('start');

  // Handle detection messages from MQTT
  const handleDetection = useCallback((detection: any, topic: string) => {
    // Convert MQTT detection to internal format
    const attachmentId = topic.split('/')[2]; // minefinder/attachment/{id}/detection
    processDetection({
      detection_id: `${attachmentId}-${Date.now()}`,
      timestamp: detection.ts || Date.now(),
      position: {
        x_cm: detection.position?.x_cm || 0,
        y_cm: detection.position?.y_cm || 0,
        x_m: detection.position?.x_m || 0,
        y_m: detection.position?.y_m || 0,
      },
      result: detection.result || 'clear',
      confidence: detection.confidence || 0,
      sensor_id: detection.sensor_id || attachmentId,
    });
  }, [processDetection]);

  // Handle attachment status messages from MQTT
  const handleAttachmentStatus = useCallback((status: any, topic: string) => {
    const attachmentId = topic.split('/')[2]; // minefinder/attachment/{id}/status
    const attachment: Attachment = {
      id: attachmentId,
      name: status.attachment_name || attachmentId,
      type: status.mode === 'simulator' ? 'thermal' : 'metal_detector',
      status: status.online ? 'online' : 'offline',
      last_seen: status.ts || Date.now(),
      discovered_at: Date.now(),
      is_discovered: true,
      communication: {
        type: 'mqtt',
        mqtt_topic: topic,
      },
    };
    discoverAttachment(attachment);
  }, [discoverAttachment]);

  // Initialize MQTT connection on mount
  useEffect(() => {
    // Connect to HiveMQ Cloud (or local broker)
    const config = {
      brokerUrl: 'broker.hivemq.com', // Default public broker for development
      port: 8884,                      // WSS port for browser
      protocol: 'wss' as const,
      // For HiveMQ Cloud, set credentials:
      // username: 'your-username',
      // password: 'your-password',
    };

    mqttConnect(config).then((success) => {
      if (success) {
        console.log('[App] MQTT connected, setting up handlers');
        // Register handlers for detection and status messages
        mqttService.onDetection(handleDetection);
        mqttService.onAttachmentStatus(handleAttachmentStatus);
      }
    });

    // Cleanup on unmount
    return () => {
      mqttDisconnect();
    };
  }, [mqttConnect, mqttDisconnect, handleDetection, handleAttachmentStatus]);

  // Handle user clicks on map during mission planning - receives GPS coordinates
  const handleMapClick = useCallback((gps: { latitude: number; longitude: number }) => {
    // Disable interaction during active missions
    if (activeMission && activeMission.status === 'active') {
      return;
    }

    // Create position with GPS coordinates
    const position = {
      x_cm: 0,  // Will be calculated by PathFinder from GPS
      y_cm: 0,
      x_m: 0,
      y_m: 0,
      gps: {
        latitude: gps.latitude,
        longitude: gps.longitude,
      },
    };

    // Set start or goal position based on current mode
    if (clickMode === 'start') {
      setDraftStart(position);
      setClickMode('goal');  // Auto-advance to goal selection for UX efficiency
    } else {
      setDraftGoal(position);
    }
  }, [activeMission, clickMode, setDraftStart, setDraftGoal]);

  // Create mission from draft positions and send to hardware
  const handleCreateMission = () => {
    if (!draftStart || !draftGoal) return;
    if (!draftStart.gps || !draftGoal.gps) {
      console.error('Cannot create mission without GPS coordinates');
      return;
    }

    // Clear previous mission detections
    clearDetections();

    // Create mission object with all required parameters
    const mission = createMission({
      start: draftStart,
      goal: draftGoal,
      corridor: {
        width_cm: 5000,    // 50m corridor width
        height_cm: 3000,   // 30m corridor height
        metres_per_cm: 0.01,
      },
      metres_per_cm: 0.01,
    });

    // Transmit mission parameters to all selected attachments via MQTT
    if (isConnected && selectedAttachmentIds.size > 0) {
      // Send mission start command to each selected attachment
      selectedAttachmentIds.forEach(attachmentId => {
        mqttService.sendMissionStart(attachmentId, {
          mission_id: mission.mission_id,
          start: {
            lat: draftStart.gps!.latitude,
            lon: draftStart.gps!.longitude,
          },
          goal: {
            lat: draftGoal.gps!.latitude,
            lon: draftGoal.gps!.longitude,
          },
          parameters: {
            altitude_m: 10,
            grid_size_m: 1,       // Each cell is 1m²
            corridor_width_m: 50,
            speed_ms: 2,
            confidence_threshold: 0.5,
          },
        });
      });
    }

    // Transition mission to active state
    startMission(mission);

    // Reset UI to start mode for next mission planning
    setClickMode('start');
  };

  // Handle mission start
  const handleStartMission = () => {
    if (!activeMission) return;
    startMission(activeMission);
  };

  // Handle mission complete
  const handleCompleteMission = () => {
    if (!activeMission) return;
    completeMission(activeMission.mission_id);
    // Reset to start mode for next mission
    setClickMode('start');
  };

  // Handle mission abort
  const handleAbortMission = () => {
    if (!activeMission) return;
    abortMission(activeMission.mission_id);
    // Reset to start mode for next mission
    setClickMode('start');
  };

  // Export to PathFinder
  const handleExportPathFinder = async () => {
    if (!activeMission) return;

    try {
      const result = await PathFinderService.saveMissionExport(
        activeMission,
        useDetectionStore.getState().aggregator,
        0.5
      );

      if (result.success) {
        alert(`Mission exported to: ${result.path}`);
      } else {
        alert(`Export failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert(`Export error: ${error}`);
    }
  };

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: '#1a1a1a', color: '#fff' }}>
      {/* Left Sidebar */}
      <div
        className="sidebar"
        style={{
          width: '320px',
          minWidth: '320px',
          borderRight: '1px solid #333',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid #333' }}>
          <h1 style={{ margin: 0, fontSize: '24px' }}>MineFinder</h1>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            Mission Controller
          </div>
        </div>

        <div style={{ borderBottom: '1px solid #333' }}>
          <MissionForm
            startPosition={draftStart}
            goalPosition={draftGoal}
            mode={clickMode}
            onSetMode={setClickMode}
            onSetStart={setDraftStart}
            onSetGoal={setDraftGoal}
            onClear={() => {
              clearDraft();
              setClickMode('start'); // Reset to start mode
            }}
            onCreateMission={handleCreateMission}
            disabled={!!activeMission}
          />
        </div>

        <div style={{ borderBottom: '1px solid #333' }}>
          <AttachmentSelector
            attachments={attachments}
            selectedIds={selectedAttachmentIds}
            onToggle={toggleAttachment}
            onClearSelection={clearSelection}
          />
        </div>

        <div style={{ padding: '16px', fontSize: '12px', color: '#666' }}>
          <div>Connection: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</div>
        </div>
      </div>

      {/* Main Content */}
      <div
        className="main-content"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top Bar - Mission Dashboard */}
        <div style={{ padding: '16px', borderBottom: '1px solid #333' }}>
          <MissionDashboard
            mission={activeMission}
            detectionCount={detections.length}
            onStart={handleStartMission}
            onComplete={handleCompleteMission}
            onAbort={handleAbortMission}
            onExportPathFinder={handleExportPathFinder}
          />
        </div>

        {/* Grid Visualization */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '24px',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <Grid
            startPosition={activeMission ? activeMission.start : draftStart}
            goalPosition={activeMission ? activeMission.goal : draftGoal}
            onPositionClick={handleMapClick}
            disabled={activeMission?.status === 'active'}
          />
        </div>

        {/* Bottom Bar - Stats */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: '#999',
          }}
        >
          <div>Detections: {detections.length}</div>
          {/* Show click mode indicator only when positions are not both set */}
          {(activeMission || (!draftStart || !draftGoal)) && (
            <div
              style={{
                padding: '6px 12px',
                backgroundColor: activeMission && activeMission.status === 'active' 
                  ? '#1a1a1a' 
                  : clickMode === 'start' ? '#0a2a0a' : '#0a1a2a',
                border: `1px solid ${
                  activeMission && activeMission.status === 'active'
                    ? '#666'
                    : clickMode === 'start' ? '#0f0' : '#06f'
                }`,
                borderRadius: '4px',
                fontWeight: 'bold',
                color: activeMission && activeMission.status === 'active'
                  ? '#666'
                  : clickMode === 'start' ? '#0f0' : '#06f',
              }}
            >
              {activeMission && activeMission.status === 'active'
                ? 'Mission Active'
                : clickMode === 'start'
                ? 'Click to Set Start (A)'
                : 'Click to Set Goal (B)'}
            </div>
          )}
          <div>Click map to set A/B waypoints</div>
        </div>
      </div>
    </div>
  );
}

export default App;
