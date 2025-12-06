import React, { useEffect, useState } from 'react';
import { piControllerService } from '../services/pi/PiControllerService';
import { useTelemetryStore } from '../stores/telemetryStore';

export function OptionsPanel() {
  const tel = useTelemetryStore();

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

      {statusMsg && (
        <div style={{ marginTop: 12, color: '#f88', fontSize: 12 }}>{statusMsg}</div>
      )}
    </div>
  );
}
