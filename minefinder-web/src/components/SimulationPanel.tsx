/**
 * Simulation Panel Component
 * 
 * Controls for simulation mode settings including speed, mine buffer distance,
 * and telemetry rate. These settings are applied when starting a mission.
 */

import { useEffect } from 'react';
import { useSimulationStore } from '../stores/simulationStore';

export function SimulationPanel() {
  const sim = useSimulationStore();

  useEffect(() => {
    // Load persisted simulation settings on mount
    try {
      const simEnabled = localStorage.getItem('mf.sim.enabled');
      const simSpeed = localStorage.getItem('mf.sim.speed');
      const simBuf = localStorage.getItem('mf.sim.buffer');
      const simHz = localStorage.getItem('mf.sim.hz');
      if (simEnabled != null) sim.setEnabled(simEnabled === '1');
      if (simSpeed != null) sim.setSimulatedSpeed(parseFloat(simSpeed));
      if (simBuf != null) sim.setMineBuffer(parseFloat(simBuf));
      if (simHz != null) sim.setTelemetryHz(parseFloat(simHz));
    } catch {}
  }, []);

  const handleSave = () => {
    // Persist to localStorage
    try {
      localStorage.setItem('mf.sim.enabled', sim.enabled ? '1' : '0');
      localStorage.setItem('mf.sim.speed', String(sim.simulated_speed_ms));
      localStorage.setItem('mf.sim.buffer', String(sim.mine_buffer_m));
      localStorage.setItem('mf.sim.hz', String(sim.telemetry_hz));
    } catch (e) {
      console.error('Failed to save simulation settings:', e);
    }
  };

  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ marginTop: 0 }}>Simulation Settings</h3>

      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
        Configure simulation parameters for testing
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input 
            type="checkbox" 
            checked={sim.enabled} 
            onChange={(e) => {
              sim.setEnabled(e.target.checked);
              handleSave();
            }} 
          />
          <span>Enable Simulation Mode</span>
        </label>

        <div>
          <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>
            Speed (m/s)
          </label>
          <input 
            type="number" 
            value={sim.simulated_speed_ms} 
            min={0} 
            step={0.1} 
            onChange={(e) => {
              sim.setSimulatedSpeed(parseFloat(e.target.value || '0'));
              handleSave();
            }} 
            style={{ width: '100%' }} 
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>
            Mine buffer (m)
          </label>
          <input 
            type="number" 
            value={sim.mine_buffer_m} 
            min={0} 
            step={0.5} 
            onChange={(e) => {
              sim.setMineBuffer(parseFloat(e.target.value || '3'));
              handleSave();
            }} 
            style={{ width: '100%' }} 
          />
        </div>

        <div style={{ gridColumn: '1 / span 2' }}>
          <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>
            Telemetry rate (Hz)
          </label>
          <input 
            type="number" 
            value={sim.telemetry_hz} 
            min={0.2} 
            step={0.2} 
            onChange={(e) => {
              sim.setTelemetryHz(parseFloat(e.target.value || '5'));
              handleSave();
            }} 
            style={{ width: '100%' }} 
          />
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-disabled)', fontStyle: 'italic' }}>
        Settings are applied when mission starts
      </div>
    </div>
  );
}
