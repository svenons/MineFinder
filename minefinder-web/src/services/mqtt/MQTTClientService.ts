/**
 * MQTT Client Service for MineFinder Control Panel
 * Connects to HiveMQ Cloud (or other MQTT broker) to communicate with attachments
 */

import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { MQTTTopics } from './topics';
import type {
  MessageEnvelope,
  AttachmentStatusMessage,
  TelemetryMessage,
  DetectionMessage,
  MissionStartCommand,
  MissionStopCommand,
  CommandAckMessage
} from './types';

export interface MQTTConfig {
  brokerUrl: string;
  port: number;
  protocol: 'mqtt' | 'mqtts' | 'ws' | 'wss';
  username?: string;
  password?: string;
  clientId?: string;
}

type MessageHandler<T = any> = (message: T, topic: string) => void;

export class MQTTClientService {
  private client: MqttClient | null = null;
  private config: MQTTConfig | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private connected: boolean = false;

  constructor() {
    console.log('[MQTT] Service initialized');
  }

  /**
   * Connect to MQTT broker
   */
  async connect(config: MQTTConfig): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        this.config = config;
        const clientId = config.clientId || `minefinder-panel-${Date.now()}`;

        const brokerUrl = `${config.protocol}://${config.brokerUrl}:${config.port}`;
        
        console.log(`[MQTT] Connecting to ${brokerUrl} as ${clientId}`);

        this.client = mqtt.connect(brokerUrl, {
          clientId,
          username: config.username,
          password: config.password,
          clean: true,
          reconnectPeriod: 5000,
          connectTimeout: 30000,
        });

        this.client.on('connect', () => {
          console.log('[MQTT] Connected to broker');
          this.connected = true;

          // Subscribe to attachment discovery topics
          this.subscribe('minefinder/attachment/+/status');
          this.subscribe('minefinder/attachment/+/heartbeat');
          this.subscribe('minefinder/attachment/+/telemetry');
          this.subscribe('minefinder/attachment/+/detection');
          this.subscribe('minefinder/attachment/+/command/ack');

          resolve(true);
        });

        this.client.on('error', (error) => {
          console.error('[MQTT] Connection error:', error);
          this.connected = false;
          reject(error);
        });

        this.client.on('disconnect', () => {
          console.warn('[MQTT] Disconnected from broker');
          this.connected = false;
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message);
        });

      } catch (error) {
        console.error('[MQTT] Failed to connect:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from broker
   */
  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
      console.log('[MQTT] Disconnected');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Subscribe to a topic
   */
  private subscribe(topic: string, qos: 0 | 1 | 2 = 0): void {
    if (!this.client) return;
    
    this.client.subscribe(topic, { qos }, (err) => {
      if (err) {
        console.error(`[MQTT] Failed to subscribe to ${topic}:`, err);
      } else {
        console.log(`[MQTT] Subscribed to ${topic}`);
      }
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(topic: string, message: Buffer): void {
    try {
      const data = JSON.parse(message.toString());
      
      // Extract payload from envelope if present
      const payload = data.payload || data;

      // Route message to handlers
      this.handlers.forEach((handlers, pattern) => {
        if (this.topicMatches(topic, pattern)) {
          handlers.forEach(handler => handler(payload, topic));
        }
      });

    } catch (error) {
      console.error('[MQTT] Error parsing message:', error);
    }
  }

  /**
   * Check if topic matches pattern (simple wildcard support)
   */
  private topicMatches(topic: string, pattern: string): boolean {
    const topicParts = topic.split('/');
    const patternParts = pattern.split('/');

    if (patternParts.length !== topicParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '+') continue; // Single level wildcard
      if (patternParts[i] === '#') return true; // Multi level wildcard
      if (patternParts[i] !== topicParts[i]) return false;
    }

    return true;
  }

  /**
   * Register message handler for a topic pattern
   */
  on<T = any>(topicPattern: string, handler: MessageHandler<T>): void {
    if (!this.handlers.has(topicPattern)) {
      this.handlers.set(topicPattern, []);
    }
    this.handlers.get(topicPattern)!.push(handler);
  }

  /**
   * Remove message handler
   */
  off(topicPattern: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(topicPattern);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Publish a message
   */
  private publish(topic: string, message: any, qos: 0 | 1 | 2 = 0): void {
    if (!this.client || !this.connected) {
      console.warn('[MQTT] Cannot publish - not connected');
      return;
    }

    const envelope: MessageEnvelope = {
      msg_id: this.generateId(),
      ts: Date.now(),
      payload: message
    };

    this.client.publish(topic, JSON.stringify(envelope), { qos }, (err) => {
      if (err) {
        console.error(`[MQTT] Failed to publish to ${topic}:`, err);
      }
    });
  }

  /**
   * Generate unique message ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Subscribe to attachment status updates
   */
  onAttachmentStatus(handler: MessageHandler<AttachmentStatusMessage>): void {
    this.on('minefinder/attachment/+/status', handler);
  }

  /**
   * Subscribe to attachment heartbeats
   */
  onAttachmentHeartbeat(handler: MessageHandler<any>): void {
    this.on('minefinder/attachment/+/heartbeat', handler);
  }

  /**
   * Subscribe to telemetry updates
   */
  onTelemetry(handler: MessageHandler<TelemetryMessage>): void {
    this.on('minefinder/attachment/+/telemetry', handler);
  }

  /**
   * Subscribe to detection events
   */
  onDetection(handler: MessageHandler<DetectionMessage>): void {
    this.on('minefinder/attachment/+/detection', handler);
  }

  /**
   * Subscribe to command acknowledgments
   */
  onCommandAck(handler: MessageHandler<CommandAckMessage>): void {
    this.on('minefinder/attachment/+/command/ack', handler);
  }

  /**
   * Send mission start command to attachment
   */
  async sendMissionStart(
    attachmentId: string,
    command: Omit<MissionStartCommand, 'type'>
  ): Promise<void> {
    if (!this.client) {
      throw new Error('MQTT client not connected');
    }

    const topic = MQTTTopics.attachment.command(attachmentId);
    const envelope: MessageEnvelope = {
      msg_id: crypto.randomUUID(),
      ts: Date.now(),
      correlation_id: crypto.randomUUID(),
      payload: {
        type: 'mission_start',
        ...command,
      },
    };

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, JSON.stringify(envelope), { qos: 2 }, (err) => {
        if (err) {
          console.error('[MQTT] Failed to send mission start:', err);
          reject(err);
        } else {
          console.log('[MQTT] Mission start command sent');
          resolve();
        }
      });
    });
  }

  /**
   * Send mission stop command to attachment
   */
  async sendMissionStop(attachmentId: string, missionId: string): Promise<void> {
    if (!this.client) {
      throw new Error('MQTT client not connected');
    }

    const topic = MQTTTopics.attachment.command(attachmentId);
    const envelope: MessageEnvelope = {
      msg_id: crypto.randomUUID(),
      ts: Date.now(),
      correlation_id: crypto.randomUUID(),
      payload: {
        type: 'mission_stop',
        mission_id: missionId,
      },
    };

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, JSON.stringify(envelope), { qos: 2 }, (err) => {
        if (err) {
          console.error('[MQTT] Failed to send mission stop:', err);
          reject(err);
        } else {
          console.log('[MQTT] Mission stop command sent');
          resolve();
        }
      });
    });
  }
}

// Singleton instance
export const mqttService = new MQTTClientService();
