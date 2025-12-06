/**
 * MQTT Connection Panel
 * 
 * View component for MQTT broker connection management.
 * Replaces the old serial port connection UI.
 * 
 * MVVM Pattern:
 * - Model: MQTTStore (connection state)
 * - ViewModel: useMQTTStore hook
 * - View: This component (stateless, driven by store)
 * 
 * Features:
 * - HiveMQ Cloud connection configuration
 * - Connection status indicator
 * - Auto-reconnect option
 * - Credential input (stored in localStorage)
 */

import { useState, useEffect } from 'react';
import { useMQTTStore } from '../stores/mqttStore';

export function MQTTConnectionPanel() {
  const { connected, connecting, error, connect, disconnect } = useMQTTStore();
  
  // Load config from localStorage
  const loadConfig = () => {
    try {
      const saved = localStorage.getItem('mqtt_config');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load MQTT config:', e);
    }
    return {
      brokerUrl: '',
      port: 8883,
      protocol: 'mqtts',
      username: '',
      password: '',
    };
  };

  const [config, setConfig] = useState(loadConfig);
  const [showPassword, setShowPassword] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Auto-connect on mount if credentials exist
  useEffect(() => {
    if (config.brokerUrl && config.username && !connected && !connecting) {
      console.log('[MQTTConnection] Auto-connecting with saved credentials');
      handleConnect();
    }
  }, []);

  const handleConnect = async () => {
    // Save config
    try {
      localStorage.setItem('mqtt_config', JSON.stringify(config));
    } catch (e) {
      console.error('Failed to save config:', e);
    }

    // Connect
    await connect({
      ...config,
      clientId: `minefinder-panel-${Date.now()}`,
    });
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <div className="mqtt-connection-panel">
      <div className="panel-header">
        <h3>MQTT</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className={`status-indicator ${connected ? 'connected' : connecting ? 'connecting' : 'disconnected'}`}>
            {connected ? '🟢' : connecting ? '🟡' : '🔴'}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px',
            }}
            title="MQTT Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {error && showSettings && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {showSettings && !connected && !connecting && (
        <div className="connection-form">
          <div className="form-group">
            <label>Broker URL</label>
            <input
              type="text"
              placeholder="your-cluster.hivemq.cloud"
              value={config.brokerUrl}
              onChange={(e) => setConfig({ ...config, brokerUrl: e.target.value })}
              disabled={connecting}
            />
          </div>

          <div className="form-group">
            <label>Port</label>
            <input
              type="number"
              value={config.port}
              onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) })}
              disabled={connecting}
            />
          </div>

          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              placeholder="MQTT Username"
              value={config.username}
              onChange={(e) => setConfig({ ...config, username: e.target.value })}
              disabled={connecting}
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <div className="password-input">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="MQTT Password"
                value={config.password}
                onChange={(e) => setConfig({ ...config, password: e.target.value })}
                disabled={connecting}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="toggle-password"
              >
                {showPassword ? '👁️' : '🔒'}
              </button>
            </div>
          </div>

          <button
            onClick={handleConnect}
            disabled={!config.brokerUrl || !config.username || !config.password || connecting}
            className="connect-button"
          >
            {connecting ? 'Connecting...' : 'Connect to Broker'}
          </button>

          <div className="info-text">
            💡 Use HiveMQ Cloud free tier or your own MQTT broker
          </div>
        </div>
      )}

      {connected && (
        <div className="connected-info">
          {showSettings && (
            <>
              <div className="info-row">
                <span className="label">Broker:</span>
                <span className="value">{config.brokerUrl}:{config.port}</span>
              </div>
              <div className="info-row">
                <span className="label">User:</span>
                <span className="value">{config.username}</span>
              </div>
            </>
          )}
          <button onClick={handleDisconnect} className="disconnect-button">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
