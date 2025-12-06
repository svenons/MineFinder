"""MQTT client for MineFinder attachment"""

import paho.mqtt.client as mqtt
import ssl
import json
import time
import uuid
import logging
from typing import Callable, Dict, Any, Optional
from .topics import MQTTTopics


class MineFinderMQTTClient:
    """MQTT client for MineFinder attachment to communicate with control panel"""
    
    def __init__(self, attachment_id: str):
        self.attachment_id = attachment_id
        self.client = mqtt.Client(client_id=f"minefinder-{attachment_id}-{uuid.uuid4().hex[:8]}")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect
        self.command_handlers: Dict[str, Callable] = {}
        self.log = logging.getLogger(__name__)
        self.connected = False
        
        # Last Will - mark offline if connection lost
        self.client.will_set(
            MQTTTopics.attachment_status(attachment_id),
            payload=json.dumps({
                "online": False,
                "ts": int(time.time() * 1000)
            }),
            qos=1,
            retain=True
        )
    
    def connect(self, host: str, port: int = 8883, username: Optional[str] = None, 
                password: Optional[str] = None, use_tls: bool = True):
        """Connect to MQTT broker (HiveMQ Cloud)"""
        try:
            if use_tls:
                self.client.tls_set(tls_version=ssl.PROTOCOL_TLS)
            
            if username and password:
                self.client.username_pw_set(username, password)
            
            self.log.info(f"Connecting to MQTT broker: {host}:{port}")
            self.client.connect(host, port, keepalive=60)
            self.client.loop_start()
            
            # Wait for connection
            timeout = 10
            start = time.time()
            while not self.connected and (time.time() - start) < timeout:
                time.sleep(0.1)
            
            if not self.connected:
                self.log.error("Failed to connect to MQTT broker within timeout")
                return False
            
            return True
            
        except Exception as e:
            self.log.error(f"MQTT connection error: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from MQTT broker"""
        self.client.loop_stop()
        self.client.disconnect()
        self.connected = False
    
    def _on_connect(self, client, userdata, flags, rc):
        """Callback when connected to broker"""
        if rc == 0:
            self.log.info("Connected to MQTT broker")
            self.connected = True
            
            # Subscribe to command topic
            command_topic = MQTTTopics.attachment_command(self.attachment_id)
            client.subscribe(command_topic, qos=2)
            self.log.info(f"Subscribed to: {command_topic}")
            
        else:
            self.log.error(f"Connection failed with code {rc}")
            self.connected = False
    
    def _on_disconnect(self, client, userdata, rc):
        """Callback when disconnected from broker"""
        self.connected = False
        if rc != 0:
            self.log.warning(f"Unexpected disconnect (code {rc}), will auto-reconnect")
    
    def _on_message(self, client, userdata, msg):
        """Callback when message received"""
        try:
            payload = json.loads(msg.payload.decode())
            self.log.debug(f"Received message on {msg.topic}: {payload}")
            
            # Extract message envelope
            msg_id = payload.get('msg_id')
            correlation_id = payload.get('correlation_id')
            data = payload.get('payload', payload)
            
            # Handle commands
            if 'command' in msg.topic:
                command_type = data.get('type')
                if command_type in self.command_handlers:
                    try:
                        self.command_handlers[command_type](data)
                        
                        # Send ACK if correlation_id present
                        if correlation_id:
                            self.publish_command_ack(correlation_id, success=True)
                    except Exception as e:
                        self.log.error(f"Error handling command {command_type}: {e}")
                        if correlation_id:
                            self.publish_command_ack(correlation_id, success=False, error=str(e))
                else:
                    self.log.warning(f"No handler for command type: {command_type}")
                    
        except Exception as e:
            self.log.error(f"Error processing message: {e}")
    
    def register_handler(self, command_type: str, handler: Callable):
        """Register a handler for a specific command type"""
        self.command_handlers[command_type] = handler
        self.log.info(f"Registered handler for command: {command_type}")
    
    def _create_envelope(self, payload: dict, correlation_id: Optional[str] = None) -> dict:
        """Create message envelope with metadata"""
        envelope = {
            'msg_id': str(uuid.uuid4()),
            'ts': int(time.time() * 1000),
            'payload': payload
        }
        if correlation_id:
            envelope['correlation_id'] = correlation_id
        return envelope
    
    def publish_status(self, status: Dict[str, Any]):
        """Publish attachment status"""
        topic = MQTTTopics.attachment_status(self.attachment_id)
        status['ts'] = int(time.time() * 1000)
        status['attachment_id'] = self.attachment_id
        envelope = self._create_envelope(status)
        self.client.publish(topic, json.dumps(envelope), qos=1, retain=True)
        self.log.debug(f"Published status to {topic}")
    
    def publish_heartbeat(self):
        """Publish heartbeat"""
        topic = MQTTTopics.attachment_heartbeat(self.attachment_id)
        data = {
            'ts': int(time.time() * 1000),
            'attachment_id': self.attachment_id
        }
        self.client.publish(topic, json.dumps(data), qos=0)
    
    def publish_telemetry(self, telemetry: Dict[str, Any]):
        """Publish telemetry data (QoS 0 for high-frequency)"""
        topic = MQTTTopics.attachment_telemetry(self.attachment_id)
        telemetry['ts'] = int(time.time() * 1000)
        envelope = self._create_envelope(telemetry)
        self.client.publish(topic, json.dumps(envelope), qos=0)
    
    def publish_detection(self, detection: Dict[str, Any]):
        """Publish detection event (QoS 1 for reliability)"""
        topic = MQTTTopics.attachment_detection(self.attachment_id)
        detection['ts'] = int(time.time() * 1000)
        envelope = self._create_envelope(detection)
        self.client.publish(topic, json.dumps(envelope), qos=1)
        self.log.info(f"Published detection: {detection.get('result')} at confidence {detection.get('confidence')}")
    
    def publish_path(self, waypoints: list):
        """Publish calculated path"""
        topic = MQTTTopics.attachment_telemetry(self.attachment_id)
        data = {
            'type': 'path_update',
            'waypoints': waypoints,
            'ts': int(time.time() * 1000)
        }
        envelope = self._create_envelope(data)
        self.client.publish(topic, json.dumps(envelope), qos=1)
    
    def publish_command_ack(self, correlation_id: str, success: bool = True, error: Optional[str] = None):
        """Publish command acknowledgment"""
        topic = MQTTTopics.attachment_command_ack(self.attachment_id)
        data = {
            'correlation_id': correlation_id,
            'success': success,
            'error': error,
            'ts': int(time.time() * 1000)
        }
        self.client.publish(topic, json.dumps(data), qos=1)
