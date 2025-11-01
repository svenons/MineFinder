"""
Data models: configuration and entities.
"""
from dataclasses import dataclass


@dataclass
class Config:
    width_cm: int = 50
    height_cm: int = 30
    metres_per_cm: float = 0.1  # 1 cm = 0.1 m by default


@dataclass
class Drone:
    x_cm: int = 0
    y_cm: int = 0
