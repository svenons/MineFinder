/**
 * Attachment Selector Component
 * 
 * Interface for selecting which hardware sensors/attachments should participate
 * in the current mission. Displays attachment metadata (type, status, battery),
 * communication info, and allows multi-selection for coordinated operations.
 * 
 * Attachment Types:
 * - metal_detector: Electromagnetic induction sensors
 * - thermal: Infrared temperature mapping
 * - ground_penetrating_radar: Subsurface object detection
 * - multi_sensor: Combined sensor arrays
 * 
 * Status indicators show real-time attachment health and readiness.
 */

import type { Attachment } from '../types/mission.types';

/**
 * Component properties for attachment selection interface
 */
interface AttachmentSelectorProps {
  attachments: Attachment[];             // Available attachments from registry
  selectedIds: Set<string>;              // Currently selected attachment IDs
  onToggle: (id: string) => void;        // Toggle attachment selection
  onClearSelection?: () => void;         // Deselect all attachments
}

export function AttachmentSelector({
  attachments,
  selectedIds,
  onToggle,
  onClearSelection,
}: AttachmentSelectorProps) {
  // Map attachment operational status to color for visual indicators
  const getStatusColor = (status: Attachment['status']): string => {
    switch (status) {
      case 'online':
        return '#0f0';      // Green: ready and connected
      case 'scanning':
        return '#ff0';      // Yellow: actively scanning
      case 'standby':
        return '#0af';      // Cyan: idle but available
      case 'offline':
        return '#666';      // Gray: disconnected
      case 'error':
        return '#f00';      // Red: malfunction detected
      case 'calibrating':
        return '#f90';      // Orange: initialization in progress
      default:
        return '#999';      // Light gray: unknown state
    }
  };

  // Icon representation for different sensor types
  const getSensorTypeIcon = (type: Attachment['type']): string => {
    switch (type) {
      case 'metal_detector':
        return '🔍';  // Magnifying glass for EM sensors
      case 'thermal':
        return '🌡️';  // Thermometer for IR sensors
      case 'ground_penetrating_radar':
        return '📡';  // Radar dish for GPR
      case 'multi_sensor':
        return '🎛️';  // Control panel for combined arrays
      default:
        return '📦';
    }
  };

  return (
    <div className="attachment-selector" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Select Attachments</h3>
        {onClearSelection && selectedIds.size > 0 && (
          <button onClick={onClearSelection} style={{ padding: '4px 12px' }}>
            Clear ({selectedIds.size})
          </button>
        )}
      </div>

      {attachments.length === 0 ? (
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic' }}>No attachments available</div>
      ) : (
        <div className="attachment-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {attachments.map((attachment) => (
            <label
              key={attachment.id}
              className="attachment-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                backgroundColor: 'var(--color-background-hover)',
                borderRadius: '4px',
                cursor: attachment.status === 'offline' ? 'not-allowed' : 'pointer',
                opacity: attachment.status === 'offline' ? 0.5 : 1,
                border: selectedIds.has(attachment.id) ? '2px solid #0af' : '2px solid transparent',
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(attachment.id)}
                onChange={() => onToggle(attachment.id)}
                disabled={attachment.status === 'offline'}
                style={{ cursor: 'inherit' }}
              />

              <div style={{ fontSize: '24px' }}>{getSensorTypeIcon(attachment.type)}</div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{attachment.id}</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  {attachment.specs.model} • {attachment.type.replace(/_/g, ' ')}
                </div>
              </div>

              <div
                className="status-indicator"
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: getStatusColor(attachment.status),
                }}
                title={attachment.status}
              />

              {attachment.battery !== undefined && (
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>🔋 {attachment.battery}%</div>
              )}
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
        {selectedIds.size} attachment{selectedIds.size !== 1 ? 's' : ''} selected •{' '}
        {attachments.filter((a) => a.status === 'online').length} online
      </div>
    </div>
  );
}
