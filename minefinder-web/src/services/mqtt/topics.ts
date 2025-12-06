/**
 * MQTT topic constants for MineFinder system
 */

export class MQTTTopics {
  static systemStatus(): string {
    return 'minefinder/system/status';
  }

  static systemConfig(): string {
    return 'minefinder/system/config';
  }

  static attachmentStatus(attachmentId: string): string {
    return `minefinder/attachment/${attachmentId}/status`;
  }

  static attachmentHeartbeat(attachmentId: string): string {
    return `minefinder/attachment/${attachmentId}/heartbeat`;
  }

  static attachmentTelemetry(attachmentId: string): string {
    return `minefinder/attachment/${attachmentId}/telemetry`;
  }

  static attachmentDetection(attachmentId: string): string {
    return `minefinder/attachment/${attachmentId}/detection`;
  }

  static attachmentCommand(attachmentId: string): string {
    return `minefinder/attachment/${attachmentId}/command`;
  }

  static attachmentCommandAck(attachmentId: string): string {
    return `minefinder/attachment/${attachmentId}/command/ack`;
  }

  static missionStart(missionId: string): string {
    return `minefinder/mission/${missionId}/start`;
  }

  static missionStop(missionId: string): string {
    return `minefinder/mission/${missionId}/stop`;
  }

  static missionStatus(missionId: string): string {
    return `minefinder/mission/${missionId}/status`;
  }

  static missionPath(missionId: string): string {
    return `minefinder/mission/${missionId}/path`;
  }

  static missionEvents(missionId: string): string {
    return `minefinder/mission/${missionId}/events`;
  }
}
