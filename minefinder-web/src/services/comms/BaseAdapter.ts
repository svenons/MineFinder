/**
 * BaseAdapter.ts
 * 
 * Abstract base class for hardware communication adapters with built-in retry logic,
 * message queuing, and serialization. Provides infrastructure for reliable message
 * delivery over unreliable transport layers (LoRa, serial, WiFi, satellite).
 * 
 * ADAPTER PATTERN:
 * BaseCommsAdapter defines common interface (send, onReceive, initialize, close).
 * Concrete implementations (TestCommsAdapter, SerialCommsAdapter, LoRaAdapter) handle
 * transport-specific details (serial port, radio module, TCP socket).
 * 
 * MESSAGE QUEUE:
 * - Send operations are non-blocking: messages queued immediately, return Promise
 * - Queue processor runs periodically (every backoff_ms) to attempt delivery
 * - Failed sends retry with exponential backoff: 1s, 2s, 4s, 8s, ...
 * - Messages removed after max_attempts or timeout_ms exceeded
 * 
 * RETRY STRATEGY:
 * Example: max_attempts=3, backoff_ms=1000, timeout_ms=5000
 * - t=0ms: Send attempt 1 → fails → schedule retry at t=1000ms
 * - t=1000ms: Send attempt 2 → fails → schedule retry at t=3000ms (backoff*2^1)
 * - t=3000ms: Send attempt 3 → fails → remove from queue, call onSendFailed()
 * - t=5000ms: If still in queue → remove, call onSendTimeout()
 * 
 * SERIALIZATION:
 * - protocol='json': JsonSerializer → UTF-8 JSON string (default, human-readable)
 * - protocol='binary': BinarySerializer → MessagePack format (compact, faster)
 * Binary mode useful for bandwidth-constrained links (LoRa: ~50 Kbps max).
 * 
 * RECEIVE FLOW:
 * 1. Transport layer receives bytes → calls handleReceive(data)
 * 2. Deserialize data → BaseMessage object
 * 3. Invoke all registered callbacks (App.tsx, detectionStore, etc.)
 * 4. Errors in callbacks logged but don't stop other callbacks
 * 
 * SUBCLASS RESPONSIBILITIES:
 * - initialize(): Open transport connection (serial port, TCP socket, etc.)
 * - close(): Clean up transport resources
 * - sendRaw(data): Write serialized bytes to transport layer
 * - Call handleReceive(data) when transport receives bytes
 * 
 * USAGE:
 * const adapter = CommsAdapterFactory.create({type: 'serial', protocol: 'json', ...});
 * await adapter.initialize();
 * adapter.onReceive((msg) => console.log('Received:', msg));
 * await adapter.send({type: 'mission_start', ts: Date.now()/1000, data: {...}});
 */

import type { BaseMessage, TransportConfig } from '../../types/mission.types';
import type { CommsAdapter, MessageSerializer, QueuedMessage } from './types';
import { JsonSerializer, BinarySerializer } from './Serializers';

/**
 * Abstract base class for communication adapters.
 * Provides retry logic, message queuing, and serialization infrastructure.
 * Concrete subclasses implement transport-specific sendRaw() method.
 */
export abstract class BaseCommsAdapter implements CommsAdapter {
  protected config: TransportConfig;
  protected serializer: MessageSerializer;
  protected messageQueue: QueuedMessage[] = [];
  protected receiveCallbacks: Array<(message: BaseMessage) => void> = [];
  protected retryTimer: ReturnType<typeof setTimeout> | null = null;
  protected connected: boolean = false;

  constructor(config: TransportConfig) {
    this.config = config;
    
    // Select serializer: JSON (human-readable) or binary (compact)
    this.serializer = config.protocol === 'binary'
      ? new BinarySerializer()
      : new JsonSerializer();
  }

  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;
  protected abstract sendRaw(data: Uint8Array | string): Promise<void>;

  /**
   * Send message with retry logic
   */
  async send(message: BaseMessage): Promise<void> {
    const queuedMsg: QueuedMessage = {
      id: this.generateMessageId(),
      message,
      attempts: 0,
      next_retry: Date.now(),
      created_at: Date.now(),
    };

    this.messageQueue.push(queuedMsg);
    await this.processQueue();
  }

  /**
   * Process message queue with retry logic.
   * Iterates queue backwards (allows safe splice during iteration). For each message:
   * 1. Check if ready for retry (next_retry <= now)
   * 2. Remove if exceeded max_attempts or timeout_ms
   * 3. Serialize and send via sendRaw()
   * 4. On success: remove from queue
   * 5. On failure: increment attempts, schedule exponential backoff retry
   * 
   * Exponential backoff formula: next_retry = now + (backoff_ms * 2^attempts)
   * Example with backoff_ms=1000: 1s, 2s, 4s, 8s, 16s, ...
   */
  private async processQueue(): Promise<void> {
    const now = Date.now();
    const retry = this.config.retry || {
      max_attempts: 3,
      backoff_ms: 1000,
      timeout_ms: 5000,
    };

    // Iterate backwards to allow safe removal during iteration
    for (let i = this.messageQueue.length - 1; i >= 0; i--) {
      const queuedMsg = this.messageQueue[i];

      // Skip messages not yet ready for retry
      if (queuedMsg.next_retry > now) {
        continue;
      }

      // Remove messages that exceeded retry limit
      if (queuedMsg.attempts >= retry.max_attempts) {
        this.messageQueue.splice(i, 1);
        this.onSendFailed(queuedMsg.message);
        continue;
      }

      // Remove messages that exceeded total timeout
      if (now - queuedMsg.created_at > retry.timeout_ms) {
        this.messageQueue.splice(i, 1);
        this.onSendTimeout(queuedMsg.message);
        continue;
      }

      // Attempt delivery
      try {
        const data = this.serializer.serialize(queuedMsg.message);
        await this.sendRaw(data);
        
        // Success: remove from queue, notify hooks
        this.messageQueue.splice(i, 1);
        this.onSendSuccess(queuedMsg.message);
      } catch (error) {
        // Failure: increment attempt counter, schedule exponential backoff
        queuedMsg.attempts++;
        queuedMsg.next_retry = now + (retry.backoff_ms * Math.pow(2, queuedMsg.attempts));
      }
    }

    // Schedule next queue processing cycle
    this.scheduleQueueProcessing();
  }

  /**
   * Schedule next queue check
   */
  private scheduleQueueProcessing(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    if (this.messageQueue.length === 0) {
      return;
    }

    const retry = this.config.retry || { backoff_ms: 1000, max_attempts: 3, timeout_ms: 5000 };
    this.retryTimer = setTimeout(() => {
      this.processQueue();
    }, retry.backoff_ms);
  }

  /**
   * Handle received data
   */
  protected handleReceive(data: Uint8Array | string): void {
    try {
      const message = this.serializer.deserialize(data);
      
      // Notify all callbacks
      for (const callback of this.receiveCallbacks) {
        try {
          callback(message);
        } catch (error) {
          console.error('Error in receive callback:', error);
        }
      }
    } catch (error) {
      console.error('Failed to deserialize message:', error);
    }
  }

  /**
   * Register receive callback
   */
  onReceive(callback: (message: BaseMessage) => void): void {
    this.receiveCallbacks.push(callback);
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get configuration
   */
  getConfig(): TransportConfig {
    return this.config;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Hook for send success (can be overridden)
   */
  protected onSendSuccess(_message: BaseMessage): void {
    // Override in subclass if needed
  }

  /**
   * Hook for send failure (can be overridden)
   */
  protected onSendFailed(message: BaseMessage): void {
    console.error('Message send failed after max retries:', message);
  }

  /**
   * Hook for send timeout (can be overridden)
   */
  protected onSendTimeout(message: BaseMessage): void {
    console.error('Message send timed out:', message);
  }
}

/**
 * TestCommsAdapter: Mock adapter for development/testing without hardware.
 * Simulates network latency (100ms) and echoes sent messages back to receiver.
 * Used in App.tsx when no hardware available. Useful for UI development,
 * protocol testing, and demo scenarios.
 * 
 * Behavior:
 * - sendRaw(): Logs message, waits 100ms, logs success
 * - After 100ms: Echoes message back via handleReceive() (simulates loopback)
 * - Always succeeds (no network errors simulated)
 */
export class TestCommsAdapter extends BaseCommsAdapter {
  private mockDelay: number = 100; // Simulated network latency (ms)

  async initialize(): Promise<void> {
    this.connected = true;
    console.log('TestCommsAdapter initialized');
  }

  async close(): Promise<void> {
    this.connected = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    console.log('TestCommsAdapter closed');
  }

  protected async sendRaw(data: Uint8Array | string): Promise<void> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, this.mockDelay));
    
    console.log('TestCommsAdapter sent:', 
      typeof data === 'string' ? data : new TextDecoder().decode(data)
    );

    // Echo message back after delay (simulate hardware response)
    setTimeout(() => {
      this.handleReceive(data);
    }, this.mockDelay);
  }
}

/**
 * SerialCommsAdapter: Adapter for LoRa modules and serial devices.
 * PLACEHOLDER - not yet implemented. Will use Web Serial API (Chrome) or
 * Electron's serialport module (Node.js) to communicate with hardware via
 * USB/UART serial connections.
 * 
 * Planned implementation:
 * - initialize(): Open serial port at config.serial_port (e.g., "COM3", "/dev/ttyUSB0")
 * - sendRaw(): Write bytes to serial port, handle flow control
 * - Listen for serial data events → call handleReceive(data)
 * - close(): Drain write buffer, close port gracefully
 * 
 * Configuration example:
 * {
 *   type: 'serial',
 *   protocol: 'binary',
 *   serial_port: '/dev/ttyUSB0',
 *   baud_rate: 115200,
 *   data_bits: 8,
 *   stop_bits: 1,
 *   parity: 'none'
 * }
 */
export class SerialCommsAdapter extends BaseCommsAdapter {
  async initialize(): Promise<void> {
    // TODO: Initialize serial port connection
    // Use Web Serial API or Electron's serialport module
    throw new Error('SerialCommsAdapter not implemented yet');
  }

  async close(): Promise<void> {
    // TODO: Close serial port
    this.connected = false;
  }

  protected async sendRaw(_data: Uint8Array | string): Promise<void> {
    // TODO: Write to serial port
    throw new Error('SerialCommsAdapter not implemented yet');
  }
}

/**
 * Factory for creating communication adapters
 */
export class CommsAdapterFactory {
  static create(config: TransportConfig): CommsAdapter {
    switch (config.type) {
      case 'test':
        return new TestCommsAdapter(config);
      
      case 'serial':
        return new SerialCommsAdapter(config);
      
      // TODO: Add more transport types (LoRa, satellite, WiFi)
      
      default:
        throw new Error(`Unsupported transport type: ${config.type}`);
    }
  }
}
