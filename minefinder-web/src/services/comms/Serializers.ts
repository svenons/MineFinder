/**
 * Serializers.ts
 * 
 * Message serialization implementations for BaseCommsAdapter.
 * Converts BaseMessage objects to wire format (string or bytes) for transmission
 * and deserializes received data back to BaseMessage objects.
 * 
 * SERIALIZATION FORMATS:
 * 1. JsonSerializer: Human-readable JSON text (default)
 *    - Pros: Easy debugging, PathFinder-compatible, no external dependencies
 *    - Cons: Larger payload size (~30% overhead vs binary)
 *    - Use case: Development, testing, serial/LoRa with adequate bandwidth
 * 
 * 2. BinarySerializer: Compact binary format (MessagePack or Protocol Buffers)
 *    - Pros: Smaller payload (~30% size reduction), faster parsing
 *    - Cons: Not human-readable, requires decoder library
 *    - Use case: Satellite links (<10 Kbps), bandwidth-constrained LoRa
 *    - Status: PLACEHOLDER - currently encodes JSON as UTF-8 bytes
 * 
 * ENCODING:
 * - JsonSerializer: JavaScript object → JSON.stringify() → UTF-8 string
 * - BinarySerializer (planned): JavaScript object → MessagePack.encode() → Uint8Array
 * - TextEncoder/TextDecoder handle UTF-8 conversion for binary transport layers
 * 
 * PATHFINDER COMPATIBILITY:
 * PathFinder Python service expects JSONL (JSON Lines) format: one JSON object per line.
 * JsonSerializer outputs pure JSON without trailing newline; MissionProtocol.ts adds '\n'.
 * Example: {"type":"mission_start","ts":123.456,"data":{...}}\n
 */

import type { BaseMessage } from '../../types/mission.types';
import type { MessageSerializer } from './types';

/**
 * JSON serializer for human-readable text protocol.
 * PathFinder-compatible, no external dependencies, easy debugging.
 */
export class JsonSerializer implements MessageSerializer {
  serialize(message: BaseMessage): string {
    return JSON.stringify(message);
  }

  deserialize(data: string | Uint8Array): BaseMessage {
    // Handle both string and binary inputs (binary converted to UTF-8 string)
    const str = typeof data === 'string' 
      ? data 
      : new TextDecoder().decode(data);
    
    return JSON.parse(str) as BaseMessage;
  }
}

/**
 * Binary serializer for compact payload format.
 * PLACEHOLDER: Currently encodes JSON as UTF-8 bytes (no size reduction).
 * TODO: Replace with MessagePack or Protocol Buffers for true binary compression.
 * 
 * Planned implementation (MessagePack):
 * - serialize(): msgpack.encode(message) → Uint8Array (~30% smaller than JSON)
 * - deserialize(): msgpack.decode(data) → BaseMessage object
 * - Install dependency: npm install msgpack-lite
 * 
 * Binary format advantages:
 * - Smaller payload: 150 bytes JSON → ~100 bytes MessagePack
 * - Faster parsing: Binary decoder ~2x faster than JSON.parse()
 * - Type preservation: Binary distinguishes integers, floats, binary data
 */
export class BinarySerializer implements MessageSerializer {
  serialize(message: BaseMessage): Uint8Array {
    // TEMPORARY: JSON encoded as UTF-8 bytes (no compression benefit)
    // Replace with: return msgpack.encode(message);
    const json = JSON.stringify(message);
    return new TextEncoder().encode(json);
  }

  deserialize(data: Uint8Array | string): BaseMessage {
    // TEMPORARY: Decode UTF-8 bytes to JSON string
    // Replace with: return msgpack.decode(data) as BaseMessage;
    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data;
    
    const str = new TextDecoder().decode(bytes);
    return JSON.parse(str) as BaseMessage;
  }
}
