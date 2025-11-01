"""
Event utilities for JSON Lines emission.
Stable protocol used across the app.
"""
import json
import sys
import time
from typing import Dict, Any


def emit(event_type: str, data: Dict[str, Any]) -> None:
    obj = {"type": event_type, "ts": time.time(), "data": data}
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()
