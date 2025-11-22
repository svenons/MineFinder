/**
 * Algorithm Selector Component
 * 
 * Displays available algorithms from the selected attachment and allows
 * the user to select one for the mission. Algorithms are what were previously
 * called "controllers" (e.g., gps_sim, gps_astar, gps_real).
 */

import { piControllerService } from '../services/pi/PiControllerService';
import { useTelemetryStore } from '../stores/telemetryStore';

export function AlgorithmSelector() {
  const tel = useTelemetryStore();

  // Get available algorithms from the selected attachment
  const selectedAttachment = tel.attachments.find(a => a.id === tel.selectedAttachmentId);
  const algorithms = selectedAttachment?.algorithms || [];

  const handleSelectAlgorithm = async (id: string) => {
    try {
      await piControllerService.selectAlgorithm(id);
    } catch (e) {
      console.error('Failed to select algorithm:', e);
    }
  };

  // Show disabled state if not connected or no attachment selected
  const isDisabled = !tel.connected || !tel.selectedAttachmentId;

  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ marginTop: 0 }}>Algorithm Selection</h3>

      {!tel.connected && (
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', fontSize: '14px' }}>
          Connect to attachment first
        </div>
      )}

      {tel.connected && !tel.selectedAttachmentId && (
        <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', fontSize: '14px' }}>
          Select an attachment first
        </div>
      )}

      {tel.connected && tel.selectedAttachmentId && (
        <>
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
            Choose navigation algorithm
          </div>

          {algorithms.length === 0 ? (
            <div style={{ color: 'var(--color-text-disabled)', fontStyle: 'italic', fontSize: '14px' }}>
              No algorithms available
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {algorithms.map((algo) => (
                <button
                  key={algo.id}
                  onClick={() => handleSelectAlgorithm(algo.id)}
                  disabled={isDisabled}
                  style={{
                    padding: '12px',
                    backgroundColor: tel.selectedAlgorithmId === algo.id 
                      ? 'var(--color-success)' 
                      : 'var(--color-background-elevated)',
                    border: tel.selectedAlgorithmId === algo.id 
                      ? '2px solid var(--color-success)' 
                      : '1px solid var(--color-border)',
                    color: tel.selectedAlgorithmId === algo.id 
                      ? '#000' 
                      : 'var(--color-text)',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    opacity: isDisabled ? 0.5 : 1,
                    textAlign: 'left',
                    borderRadius: '4px',
                    fontWeight: tel.selectedAlgorithmId === algo.id ? 'bold' : 'normal',
                  }}
                >
                  <div style={{ fontSize: '14px', marginBottom: '4px' }}>
                    {tel.selectedAlgorithmId === algo.id ? '✓ ' : ''}{algo.name || algo.id}
                  </div>
                  {algo.capabilities && algo.capabilities.length > 0 && (
                    <div style={{ fontSize: '11px', opacity: 0.7 }}>
                      {algo.capabilities.join(', ')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
