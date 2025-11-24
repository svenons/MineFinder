/**
 * Settings Modal Component
 * 
 * Modal dialog for application settings including serial connection configuration
 * and other application-wide preferences.
 */

import { useEffect, useState } from 'react';
import { piControllerService } from '../services/pi/PiControllerService';
import { useTelemetryStore } from '../stores/telemetryStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useMissionStore } from '../stores/missionStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const tel = useTelemetryStore();

  const [ports, setPorts] = useState<any[]>([]);
  const [port, setPort] = useState<string>('');
  const [baud, setBaud] = useState<number>(9600);

  const [loadingPorts, setLoadingPorts] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      // Load persisted settings when modal opens
      try {
        const p = localStorage.getItem('mf.serial.port');
        const b = localStorage.getItem('mf.serial.baud');
        if (p) setPort(p);
        if (b) setBaud(parseInt(b, 10) || 9600);
      } catch {}
      // Try to list ports on mount
      refreshPorts();
    }
  }, [isOpen]);

  async function refreshPorts() {
    setLoadingPorts(true);
    setStatusMsg('');
    try {
      const res = await (await import('../services/pi/PiSerialBridge')).piSerialBridge.listPorts();
      if (res.success) {
        setPorts(res.ports || []);
        if (!port && (res.ports?.length ?? 0) > 0) {
          // @ts-ignore
          setPort(res.ports[0].path || res.ports[0].comName || res.ports[0].friendlyName || '');
        }
      } else {
        setStatusMsg(res.error || 'Failed to list ports');
      }
    } catch (e: any) {
      setStatusMsg(e?.message || String(e));
    } finally {
      setLoadingPorts(false);
    }
  }

  async function connect() {
    setStatusMsg('');
    try {
      await piControllerService.connect(port, baud);
      try {
        localStorage.setItem('mf.serial.port', port);
        localStorage.setItem('mf.serial.baud', String(baud));
      } catch {}
    } catch (e: any) {
      setStatusMsg(e?.message || String(e));
    }
  }

  async function disconnect() {
    setStatusMsg('');
    try {
      await piControllerService.disconnect();
    } catch (e: any) {
      setStatusMsg(e?.message || String(e));
    }
  }

  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div 
        style={{
          backgroundColor: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Settings</h2>
          <button 
            onClick={onClose}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              fontSize: '24px', 
              cursor: 'pointer',
              padding: '0 8px',
              color: 'var(--color-text)',
            }}
          >
            ×
          </button>
        </div>

        {/* Serial Connection Section */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px' }}>Serial Connection</h3>
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
            Connect to the Pi server via USB serial
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div style={{ gridColumn: '1 / span 2' }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Port</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={port} onChange={(e) => setPort(e.target.value)} style={{ flex: 1 }}>
                  {ports.length === 0 && <option value="">No ports found</option>}
                  {ports.map((p, idx) => (
                    // @ts-ignore
                    <option key={idx} value={p.path || p.comName || p.friendlyName || ''}>
                      {/* @ts-ignore */}
                      {p.path || p.comName || p.friendlyName || 'Unknown'}
                    </option>
                  ))}
                </select>
                <button onClick={refreshPorts} disabled={loadingPorts}>
                  {loadingPorts ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>
                  Or enter path manually
                </label>
                <input 
                  type="text" 
                  placeholder="/dev/ttyUSB0" 
                  value={port} 
                  onChange={(e) => setPort(e.target.value)} 
                  style={{ width: '100%' }} 
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>
                Baud Rate
              </label>
              <input 
                type="number" 
                value={baud} 
                min={300} 
                max={230400} 
                step={300} 
                onChange={(e) => setBaud(parseInt(e.target.value || '9600', 10))} 
                style={{ width: '100%' }} 
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {!tel.connected ? (
                <button 
                  onClick={connect} 
                  style={{ 
                    flex: 1, 
                    padding: 8, 
                    backgroundColor: '#0a0', 
                    border: '2px solid var(--color-success)', 
                    color: 'var(--color-text)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Connect
                </button>
              ) : (
                <button 
                  onClick={disconnect} 
                  style={{ 
                    flex: 1, 
                    padding: 8, 
                    backgroundColor: '#a00', 
                    border: '2px solid var(--color-danger)', 
                    color: 'var(--color-text)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <div style={{ 
            fontSize: 12, 
            color: tel.connected ? 'var(--color-success)' : 'var(--color-danger)', 
            marginBottom: 12,
            padding: '8px',
            backgroundColor: tel.connected ? 'rgba(0, 170, 0, 0.1)' : 'rgba(170, 0, 0, 0.1)',
            borderRadius: '4px',
          }}>
            {tel.connected ? `✓ Connected (${tel.port}@${tel.baud})` : '○ Not connected'}
          </div>

          {statusMsg && (
            <div style={{ 
              marginTop: 12, 
              color: 'var(--color-danger)', 
              fontSize: 12,
              padding: '8px',
              backgroundColor: 'rgba(170, 0, 0, 0.1)',
              borderRadius: '4px',
            }}>
              {statusMsg}
            </div>
          )}
        </div>

        {/* Simulation Mode Section */}
        <SimulationModeSection />

        {/* Close button at bottom */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
          <button 
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--color-border)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--color-text)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Simulation Mode Section Component
function SimulationModeSection() {
  const sim = useSimulationStore();
  const tel = useTelemetryStore();
  const { activeMission } = useMissionStore();

  const isMissionActive = activeMission?.status === 'active';

  const handleToggleSimulation = (enabled: boolean) => {
    if (isMissionActive) {
      return; // Prevent toggling during active mission
    }

    sim.setEnabled(enabled);
    try {
      localStorage.setItem('mf.sim.enabled', enabled ? '1' : '0');
    } catch {}

    // When simulation is enabled, inject the simulation attachment
    if (enabled) {
      tel.addAttachment({
        id: 'simulation',
        name: 'Simulation',
        algorithms: [
          {
            id: 'astar-backtrack',
            name: 'A* with Backtracking',
            capabilities: ['pathfinding', 'obstacle_avoidance'],
          },
          {
            id: 'scan-entire-field',
            name: 'Scan Entire Field',
            capabilities: ['coverage', 'systematic_scan'],
          },
        ],
      });
    }
  };

  return (
    <div style={{ marginBottom: '24px', paddingTop: '24px', borderTop: '1px solid var(--color-border-subtle)' }}>
      <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px' }}>Simulation Mode</h3>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
        Enable simulation mode to access simulation attachment and place mines on the grid
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: isMissionActive ? 'not-allowed' : 'pointer', opacity: isMissionActive ? 0.5 : 1 }}>
        <input
          type="checkbox"
          checked={sim.enabled}
          onChange={(e) => handleToggleSimulation(e.target.checked)}
          disabled={isMissionActive}
          style={{ cursor: isMissionActive ? 'not-allowed' : 'pointer' }}
        />
        <span style={{ fontSize: 14 }}>Enable Simulation Mode</span>
      </label>

      {isMissionActive && sim.enabled && (
        <div style={{
          marginTop: 12,
          padding: '8px',
          backgroundColor: 'rgba(170, 170, 0, 0.1)',
          borderRadius: '4px',
          fontSize: 12,
          color: 'var(--color-warning)',
        }}>
          ⚠️ Cannot disable simulation mode during active mission
        </div>
      )}

      {sim.enabled && (
        <div style={{
          marginTop: 12,
          padding: '8px',
          backgroundColor: 'rgba(0, 170, 170, 0.1)',
          borderRadius: '4px',
          fontSize: 12,
          color: 'var(--color-info)',
        }}>
          ✓ Simulation attachment is now available
        </div>
      )}
    </div>
  );
}
