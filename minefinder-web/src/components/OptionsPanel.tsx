import React, { useEffect, useMemo, useState } from 'react';
import { piControllerService } from '../services/pi/PiControllerService';
import { useTelemetryStore } from '../stores/telemetryStore';
import { useSimulationStore } from '../stores/simulationStore';

export function OptionsPanel() {
  const tel = useTelemetryStore();
  const sim = useSimulationStore();

  const [ports, setPorts] = useState<any[]>([]);
  const [port, setPort] = useState<string>('');
  const [baud, setBaud] = useState<number>(9600);

  const [loadingPorts, setLoadingPorts] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  useEffect(() => {
    // Load persisted settings
    try {
      const p = localStorage.getItem('mf.serial.port');
      const b = localStorage.getItem('mf.serial.baud');
      if (p) setPort(p);
      if (b) setBaud(parseInt(b, 10) || 9600);
      const simEnabled = localStorage.getItem('mf.sim.enabled');
      const simSpeed = localStorage.getItem('mf.sim.speed');
      const simBuf = localStorage.getItem('mf.sim.buffer');
      const simHz = localStorage.getItem('mf.sim.hz');
      if (simEnabled != null) sim.setEnabled(simEnabled === '1');
      if (simSpeed != null) sim.setSimulatedSpeed(parseFloat(simSpeed));
      if (simBuf != null) sim.setMineBuffer(parseFloat(simBuf));
      if (simHz != null) sim.setTelemetryHz(parseFloat(simHz));
    } catch {}
    // Try to list ports on mount
    refreshPorts();
  }, []);

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

  async function applySimulationDefaults() {
    // No-op here; config is sent on mission start. This function is just for user clarity.
    setStatusMsg('Simulation settings saved (used on mission start).');
  }

  const controllerOptions = useMemo(() => {
    return tel.controllers || [];
  }, [tel.controllers]);

  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ marginTop: 0 }}>Options</h3>

      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
        Serial Connection to Pi Server
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div style={{ gridColumn: '1 / span 2' }}>
          <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Port</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={port} onChange={(e) => setPort(e.target.value)} style={{ flex: 1 }}>
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
          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Or enter path manually</label>
            <input type="text" placeholder="/dev/ttyUSB0" value={port} onChange={(e) => setPort(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#ccc' }}>Baud</label>
          <input type="number" value={baud} min={300} max={230400} step={300} onChange={(e) => setBaud(parseInt(e.target.value || '9600', 10))} style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          {!tel.connected ? (
            <button onClick={connect} style={{ flex: 1, padding: 8, backgroundColor: '#0a0', border: '2px solid var(--color-success)', color: 'var(--color-text)' }}>Connect</button>
          ) : (
            <button onClick={disconnect} style={{ flex: 1, padding: 8, backgroundColor: '#a00', border: '2px solid var(--color-danger)', color: 'var(--color-text)' }}>Disconnect</button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: tel.connected ? 'var(--color-success)' : 'var(--color-danger)', marginBottom: 12 }}>
        {tel.connected ? `Connected (${tel.port}@${tel.baud})` : 'Not connected'}
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)', margin: '12px 0' }} />

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Controller</label>
        <select
          value={tel.selectedControllerId || ''}
          onChange={(e) => piControllerService.selectController(e.target.value)}
          disabled={!tel.connected}
          style={{ width: '100%' }}
        >
          <option value="" disabled>Select controller...</option>
          {controllerOptions.map(c => (
            <option key={c.id} value={c.id}>{c.name || c.id}</option>
          ))}
        </select>
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)', margin: '12px 0' }} />

      <div>
        <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Simulation</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={sim.enabled} onChange={(e) => sim.setEnabled(e.target.checked)} />
            Enable Simulation
          </label>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Speed (m/s)</label>
            <input type="number" value={sim.simulated_speed_ms} min={0} step={0.1} onChange={(e) => sim.setSimulatedSpeed(parseFloat(e.target.value || '0'))} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Mine buffer (m)</label>
            <input type="number" value={sim.mine_buffer_m} min={0} step={0.5} onChange={(e) => sim.setMineBuffer(parseFloat(e.target.value || '3'))} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Telemetry (Hz)</label>
            <input type="number" value={sim.telemetry_hz} min={0.2} step={0.2} onChange={(e) => sim.setTelemetryHz(parseFloat(e.target.value || '5'))} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={applySimulationDefaults} style={{ width: '100%', padding: 8 }}>Save</button>
          </div>
        </div>
      </div>

      {statusMsg && (
        <div style={{ marginTop: 12, color: '#f88', fontSize: 12 }}>{statusMsg}</div>
      )}
    </div>
  );
}
