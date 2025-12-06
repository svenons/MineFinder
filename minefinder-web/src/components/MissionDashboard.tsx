/**
 * Mission Dashboard Component
 * 
 * Real-time mission status display and control interface. Shows active mission
 * metadata, detection statistics, and provides lifecycle controls (start, complete, abort).
 * Integrates with PathFinder backend for safe path computation.
 * 
 * Status States:
 * - pending: Mission created but not yet transmitted to hardware
 * - active: Mission in progress, receiving detections
 * - completed: Mission finished successfully
 * - aborted: Manually terminated
 * - failed: Error occurred during execution
 * 
 * Displays "No active mission" placeholder when idle.
 */

import type { Mission } from '../types/mission.types';
import { useTelemetryStore } from '../stores/telemetryStore';

/**
 * Component properties for mission monitoring and control
 */
interface MissionDashboardProps {
  mission: Mission | null;               // Active mission or null if none
  detectionCount: number;                // Total detections received
  onStart?: () => void;                  // Start pending mission
  onComplete?: () => void;               // Mark mission as completed
  onAbort?: () => void;                  // Emergency termination
  onExportPathFinder?: () => void;       // Export detections for path calculation
}

export function MissionDashboard({
  mission,
  detectionCount,
  onStart,
  onComplete,
  onAbort,
  onExportPathFinder,
}: MissionDashboardProps) {
  const tel = useTelemetryStore();
  
  // Get selected attachment and algorithm names
  const selectedAttachment = tel.attachments.find(a => a.id === tel.selectedAttachmentId);
  const selectedAlgorithm = selectedAttachment?.algorithms.find(alg => alg.id === tel.selectedAlgorithmId);
  
  if (!mission) {
    return (
      <div
        className="mission-dashboard"
        style={{
          padding: '16px',
          backgroundColor: 'var(--color-background-hover)',
          borderRadius: '4px',
        }}
      >
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', textAlign: 'center' }}>
          No active mission
        </div>
      </div>
    );
  }

  // Map mission status to display color for visual differentiation
  const getStatusColor = (status: Mission['status']): string => {
    switch (status) {
      case 'pending':
        return '#ff0';    // Yellow: awaiting start
      case 'active':
        return '#0f0';    // Green: in progress
      case 'completed':
        return '#06f';    // Blue: successfully finished
      case 'aborted':
        return '#f90';    // Orange: manually terminated
      case 'failed':
        return '#f00';    // Red: error condition
      default:
        return '#999';    // Gray: unknown state
    }
  };

  // Convert Unix epoch timestamp to human-readable local time
  const formatTimestamp = (ts: number): string => {
    return new Date(ts).toLocaleString();
  };

  return (
    <div
      className="mission-dashboard"
      style={{
        padding: '16px',
        backgroundColor: 'var(--color-background-hover)',
        borderRadius: '4px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ margin: 0 }}>Mission Dashboard</h3>
        <div
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            backgroundColor: getStatusColor(mission.status),
            color: '#000',
            fontWeight: 'bold',
            fontSize: '14px',
          }}
        >
          {mission.status.toUpperCase()}
        </div>
      </div>

      {/* Mission details */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
          Mission ID: {mission.mission_id}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
          Created: {formatTimestamp(mission.created_at)}
        </div>
        
        {/* Attachment and Algorithm Info */}
        {(selectedAttachment || selectedAlgorithm) && (
          <div style={{ 
            marginTop: '8px', 
            padding: '8px', 
            backgroundColor: 'var(--color-background-elevated)', 
            borderRadius: '4px',
            fontSize: '12px'
          }}>
            {selectedAttachment && (
              <div style={{ marginBottom: '4px' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Attachment: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--color-text)' }}>
                  {selectedAttachment.name}
                  {selectedAttachment.id === 'simulation' && ' 🎮'}
                </span>
              </div>
            )}
            {selectedAlgorithm && (
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Algorithm: </span>
                <span style={{ fontWeight: 'bold', color: 'var(--color-text)' }}>
                  {selectedAlgorithm.name || selectedAlgorithm.id}
                </span>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            marginTop: '12px',
          }}
        >
          <div style={{ backgroundColor: 'var(--color-background-elevated)', padding: '12px', borderRadius: '4px' }}>
            <div style={{ color: 'var(--color-success)', fontWeight: 'bold', marginBottom: '4px' }}>
              Start (A)
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              {mission.start.gps
                ? `GPS: ${mission.start.gps.latitude.toFixed(6)}, ${mission.start.gps.longitude.toFixed(6)}`
                : 'GPS: —'}
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--color-background-elevated)', padding: '12px', borderRadius: '4px' }}>
            <div style={{ color: 'var(--color-info)', fontWeight: 'bold', marginBottom: '4px' }}>
              Goal (B)
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              {mission.goal.gps
                ? `GPS: ${mission.goal.gps.latitude.toFixed(6)}, ${mission.goal.gps.longitude.toFixed(6)}`
                : 'GPS: —'}
            </div>
          </div>
        </div>
      </div>

      {/* Detection statistics */}
      <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--color-background-elevated)', borderRadius: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Detections:</span>
          <span style={{ fontWeight: 'bold', color: detectionCount > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
            {detectionCount}
          </span>
        </div>
      </div>

      {/* Control buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {mission.status === 'pending' && onStart && (
          <button
            onClick={onStart}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#0a0',
              border: '2px solid #0f0',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Start Mission
          </button>
        )}

        {mission.status === 'active' && onAbort && (
          <button
            onClick={onAbort}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#a00',
              border: '2px solid #f00',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Abort
          </button>
        )}

        {mission.status === 'completed' && onComplete && (
          <button
            onClick={onComplete}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#0a0',
              border: '2px solid #0f0',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Save Mission
          </button>
        )}

        {mission.status === 'completed' && onExportPathFinder && (
          <button
            onClick={onExportPathFinder}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#06a',
              border: '2px solid #06f',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Export to PathFinder
          </button>
        )}
      </div>
    </div>
  );
}
