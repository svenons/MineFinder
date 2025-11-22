/**
 * Attachment Selector Component
 * 
 * Displays available hardware attachments that have connected via serial.
 * After connecting, the Pi sends an identify message with attachment info.
 * User selects which attachment to use for the mission.
 */

import { useTelemetryStore } from '../stores/telemetryStore';

export function AttachmentSelector() {
  const tel = useTelemetryStore();

  const handleSelectAttachment = (id: string) => {
    tel.selectAttachment(id);
  };

  // Show disabled state if not connected
  const isDisabled = !tel.connected;

  return (
    <div className="attachment-selector" style={{ padding: '16px' }}>
      <h3 style={{ margin: 0, marginBottom: '12px' }}>Select Attachment</h3>

      {!tel.connected && (
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', fontSize: '14px' }}>
          Connect via USB first
        </div>
      )}

      {tel.connected && tel.attachments.length === 0 && (
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', fontSize: '14px' }}>
          Waiting for attachments...
        </div>
      )}

      {tel.connected && tel.attachments.length > 0 && (
        <div className="attachment-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tel.attachments.map((attachment) => (
            <button
              key={attachment.id}
              onClick={() => handleSelectAttachment(attachment.id)}
              disabled={isDisabled}
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
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled ? 0.5 : 1,
                border: tel.selectedAttachmentId === attachment.id 
                  ? '2px solid var(--color-success)' 
                  : '2px solid var(--color-border)',
                textAlign: 'left',
                fontWeight: tel.selectedAttachmentId === attachment.id ? 'bold' : 'normal',
                color: tel.selectedAttachmentId === attachment.id ? '#000' : 'var(--color-text)',
              }}
            >
              <div style={{ fontSize: '14px' }}>
                {tel.selectedAttachmentId === attachment.id ? '✓ ' : ''}{attachment.name}
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
