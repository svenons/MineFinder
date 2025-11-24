/**
 * Attachment Selector Component
 * 
 * Displays available hardware attachments that have connected via serial.
 * After connecting, the Pi sends an identify message with attachment info.
 * User selects which attachment to use for the mission.
 * 
 * When simulation mode is enabled, also displays the simulation attachment.
 */

import { useTelemetryStore } from '../stores/telemetryStore';
import { useSimulationStore } from '../stores/simulationStore';

export function AttachmentSelector() {
  const tel = useTelemetryStore();
  const sim = useSimulationStore();

  const handleSelectAttachment = (id: string) => {
    tel.selectAttachment(id);
  };

  // Filter attachments based on connection and simulation mode
  // - Simulation attachment: only shown when simulation is enabled
  // - USB attachments: only shown when connected
  const availableAttachments = tel.attachments.filter(att => {
    if (att.id === 'simulation') {
      return sim.enabled;
    }
    return tel.connected;
  });

  const hasAnyAttachments = availableAttachments.length > 0;
  const canShowAttachments = tel.connected || sim.enabled;

  return (
    <div className="attachment-selector" style={{ padding: '16px' }}>
      <h3 style={{ margin: 0, marginBottom: '12px' }}>Select Attachment</h3>

      {!canShowAttachments && (
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', fontSize: '14px' }}>
          Connect via USB or enable simulation mode in settings
        </div>
      )}

      {canShowAttachments && !hasAnyAttachments && (
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', fontSize: '14px' }}>
          {sim.enabled && !tel.connected 
            ? 'Open settings to load simulation attachment'
            : 'Waiting for attachments...'}
        </div>
      )}

      {hasAnyAttachments && (
        <div className="attachment-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {availableAttachments.map((attachment) => (
            <button
              key={attachment.id}
              onClick={() => handleSelectAttachment(attachment.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '4px',
                padding: '12px',
                backgroundColor: tel.selectedAttachmentId === attachment.id 
                  ? 'var(--color-success)' 
                  : 'var(--color-background-elevated)',
                borderRadius: '4px',
                cursor: 'pointer',
                border: tel.selectedAttachmentId === attachment.id 
                  ? '2px solid var(--color-success)' 
                  : '2px solid var(--color-border)',
                textAlign: 'left',
                fontWeight: tel.selectedAttachmentId === attachment.id ? 'bold' : 'normal',
                color: tel.selectedAttachmentId === attachment.id ? '#000' : 'var(--color-text)',
              }}
            >
              <div style={{ fontSize: '14px' }}>
                {tel.selectedAttachmentId === attachment.id ? '✓ ' : ''}
                {attachment.name}
                {attachment.id === 'simulation' && ' 🎮'}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.7 }}>
                ID: {attachment.id}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.7 }}>
                {attachment.algorithms.length} algorithm{attachment.algorithms.length !== 1 ? 's' : ''} available
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
