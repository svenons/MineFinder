"""MQTT topic constants for MineFinder system"""

class MQTTTopics:
    """Topic structure for MQTT communication"""
    
    @staticmethod
    def system_status() -> str:
        return "minefinder/system/status"
    
    @staticmethod
    def system_config() -> str:
        return "minefinder/system/config"
    
    @staticmethod
    def attachment_status(attachment_id: str) -> str:
        return f"minefinder/attachment/{attachment_id}/status"
    
    @staticmethod
    def attachment_heartbeat(attachment_id: str) -> str:
        return f"minefinder/attachment/{attachment_id}/heartbeat"
    
    @staticmethod
    def attachment_telemetry(attachment_id: str) -> str:
        return f"minefinder/attachment/{attachment_id}/telemetry"
    
    @staticmethod
    def attachment_detection(attachment_id: str) -> str:
        return f"minefinder/attachment/{attachment_id}/detection"
    
    @staticmethod
    def attachment_command(attachment_id: str) -> str:
        return f"minefinder/attachment/{attachment_id}/command"
    
    @staticmethod
    def attachment_command_ack(attachment_id: str) -> str:
        return f"minefinder/attachment/{attachment_id}/command/ack"
    
    @staticmethod
    def mission_start(mission_id: str) -> str:
        return f"minefinder/mission/{mission_id}/start"
    
    @staticmethod
    def mission_stop(mission_id: str) -> str:
        return f"minefinder/mission/{mission_id}/stop"
    
    @staticmethod
    def mission_status(mission_id: str) -> str:
        return f"minefinder/mission/{mission_id}/status"
    
    @staticmethod
    def mission_path(mission_id: str) -> str:
        return f"minefinder/mission/{mission_id}/path"
    
    @staticmethod
    def mission_events(mission_id: str) -> str:
        return f"minefinder/mission/{mission_id}/events"
