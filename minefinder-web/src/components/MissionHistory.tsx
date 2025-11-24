/**
 * Mission History Component
 * 
 * Displays a list of all past missions with their status, timestamps, and key metrics.
 * Allows users to view mission details and potentially replay or export historical missions.
 */

import { useMissionStore } from '../stores/missionStore';
import type { Mission } from '../types/mission.types';

interface MissionHistoryProps {
  onSelectMission?: (mission: Mission) => void;
}

export function MissionHistory({ onSelectMission }: MissionHistoryProps) {
  const { missionHistory } = useMissionStore();

  // Sort missions by created_at (newest first)
  const sortedMissions = [...missionHistory].sort((a, b) => b.created_at - a.created_at);

  const getStatusColor = (status: Mission['status']): string => {
    switch (status) {
      case 'pending':
        return '#ff0';
      case 'active':
        return '#0f0';
      case 'completed':
        return '#06f';
      case 'aborted':
        return '#f90';
      case 'failed':
        return '#f00';
      default:
        return '#999';
    }
  };

  const getStatusIcon = (status: Mission['status']): string => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'active':
        return '🚁';
      case 'completed':
        return '✅';
      case 'aborted':
        return '⚠️';
      case 'failed':
        return '❌';
      default:
        return '❓';
    }
  };

  const formatTimestamp = (ts: number): string => {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  if (missionHistory.length === 0) {
    return (
      <div style={{ padding: '0' }}>
        <div style={{ 
          color: 'var(--color-text-disabled)', 
          fontStyle: 'italic', 
          fontSize: '14px',
          textAlign: 'center',
          padding: '32px 16px',
        }}>
          No missions yet. Create your first mission to get started!
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0' }}>
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px',
        maxHeight: '400px',
        overflowY: 'auto',
      }}>
        {sortedMissions.map((mission) => (
          <div
            key={mission.mission_id}
            onClick={() => onSelectMission?.(mission)}
            style={{
              padding: '12px',
              backgroundColor: 'var(--color-background-elevated)',
              borderRadius: '4px',
              border: '1px solid var(--color-border)',
              cursor: onSelectMission ? 'pointer' : 'default',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (onSelectMission) {
                e.currentTarget.style.backgroundColor = 'var(--color-background-hover)';
                e.currentTarget.style.borderColor = 'var(--color-border-active)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-background-elevated)';
              e.currentTarget.style.borderColor = 'var(--color-border)';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                  {mission.mission_id.substring(0, 8)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                  {formatTimestamp(mission.created_at)}
                </div>
              </div>
              <div
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: getStatusColor(mission.status),
                  color: '#000',
                  fontWeight: 'bold',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>{getStatusIcon(mission.status)}</span>
                <span>{mission.status.toUpperCase()}</span>
              </div>
            </div>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: '8px',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
            }}>
              <div>
                <span style={{ color: 'var(--color-success)' }}>🟢 Start:</span>
                <div style={{ marginTop: '2px', fontSize: '10px', opacity: 0.8 }}>
                  {mission.start.gps
                    ? `${mission.start.gps.latitude.toFixed(4)}, ${mission.start.gps.longitude.toFixed(4)}`
                    : `${mission.start.x_cm}cm, ${mission.start.y_cm}cm`}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--color-info)' }}>🔵 Goal:</span>
                <div style={{ marginTop: '2px', fontSize: '10px', opacity: 0.8 }}>
                  {mission.goal.gps
                    ? `${mission.goal.gps.latitude.toFixed(4)}, ${mission.goal.gps.longitude.toFixed(4)}`
                    : `${mission.goal.x_cm}cm, ${mission.goal.y_cm}cm`}
                </div>
              </div>
            </div>

            {mission.corridor && (
              <div style={{ 
                marginTop: '8px',
                fontSize: '10px',
                color: 'var(--color-text-disabled)',
              }}>
                Grid: {mission.corridor.width_cm}×{mission.corridor.height_cm}cm
                {' • '}
                Scale: {mission.metres_per_cm}m/cm
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{
        marginTop: '12px',
        padding: '8px',
        backgroundColor: 'var(--color-background-hover)',
        borderRadius: '4px',
        fontSize: '11px',
        color: 'var(--color-text-muted)',
        textAlign: 'center',
      }}>
        💡 Click on a mission to view details
      </div>
    </div>
  );
}
