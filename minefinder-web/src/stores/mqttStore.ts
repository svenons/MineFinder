/**
 * MQTT Connection Store
 * 
 * MVVM state management for MQTT broker connection lifecycle.
 * Manages connection status, configuration, and initialization.
 * 
 * Architecture:
 * - Model: MQTT connection state and config
 * - ViewModel: This store (reactive state + business logic)
 * - View: Components display connection status
 * 
 * Integration:
 * - MQTTClientService handles actual MQTT protocol
 * - This store provides reactive state for UI
 * - AttachmentStore/TelemetryStore receive MQTT messages
 */

import { create } from 'zustand';
import { MQTTClientService, type MQTTConfig } from '../services/mqtt/MQTTClientService';

interface MQTTState {
  // Connection status
  connected: boolean;
  connecting: boolean;
  error: string | null;
  
  // MQTT client instance (singleton)
  client: MQTTClientService | null;
  
  // Actions
  connect: (config: MQTTConfig) => Promise<boolean>;
  disconnect: () => void;
  isConnected: () => boolean;
  getClient: () => MQTTClientService | null;
}

export const useMQTTStore = create<MQTTState>((set, get) => ({
  connected: false,
  connecting: false,
  error: null,
  client: null,

  connect: async (config: MQTTConfig) => {
    set({ connecting: true, error: null });
    
    try {
      // Create client if doesn't exist
      let client = get().client;
      if (!client) {
        client = new MQTTClientService();
        set({ client });
      }

      // Connect to broker
      const success = await client.connect(config);
      
      if (success) {
        set({ connected: true, connecting: false });
        console.log('[MQTTStore] Connected successfully');
        return true;
      } else {
        set({ connected: false, connecting: false, error: 'Connection failed' });
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      set({ connected: false, connecting: false, error: message });
      console.error('[MQTTStore] Connection error:', error);
      return false;
    }
  },

  disconnect: () => {
    const client = get().client;
    if (client) {
      client.disconnect();
    }
    set({ connected: false, connecting: false, error: null });
    console.log('[MQTTStore] Disconnected');
  },

  isConnected: () => {
    return get().connected;
  },

  getClient: () => {
    return get().client;
  },
}));
