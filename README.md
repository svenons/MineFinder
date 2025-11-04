# MineFinder

Mine detection and safe path planning system for humanitarian demining operations.

## Overview

MineFinder is an integrated hardware-software system for autonomous mine detection in humanitarian demining scenarios. The system coordinates sensor-equipped drones/rovers to scan designated areas, aggregate detection data in real-time, and compute safe transit paths between mission points.

Developed as part of the "Experts in Teams - Exploring Entrepreneurship" course (T300037401) at SDU.

## System Architecture

MineFinder consists of three integrated components:

### 1. Mission Controller (Web Application)
React-based control interface for mission planning, real-time monitoring, and data visualization.

**Key Features:**
- GPS-based mission area definition with satellite imagery overlay
- Real-time detection aggregation and visualization
- Attachment/sensor management and configuration
- Safe path computation integration with PathFinder backend
- Communication adapter system for hardware connectivity

### 2. PathFinder (Python Backend)
Path planning service that computes safe corridors through detected minefields.

**Capabilities:**
- Dijkstra-based pathfinding with mine avoidance
- Configurable safety margins and uncertainty modeling
- Mission state management and event logging
- RESTful API for mission controller integration

### 3. Hardware Attachments (Arduino/PlatformIO)
Embedded firmware for sensor modules and drone control systems.

**Supported Hardware:**
- Metal detector integration
- GPS/IMU positioning systems
- LoRa long-range communication
- Autonomous navigation control

## Course Information

- **Course**: Experts in Teams - Exploring Entrepreneurship
- **Course ID**: T300037401
- **Institution**: [SDU](https://www.sdu.dk/en)
- **Academic Year**: 2025

## Project Team

This project is being developed by a team of students as part of their coursework in exploring entrepreneurial ventures and team collaboration.

## Project Structure

```
MineFinder/
├── minefinder-web/           # Mission Controller (Electron + React + TypeScript)
│   ├── src/
│   │   ├── components/       # UI components (Grid, MissionDashboard, etc.)
│   │   ├── services/         # Business logic layer
│   │   │   ├── comms/        # Communication adapters (Serial, LoRa, Test)
│   │   │   ├── MissionProtocol.ts    # Message construction/parsing
│   │   │   ├── DetectionAggregator.ts # Detection deduplication
│   │   │   └── PathFinderService.ts   # Backend integration
│   │   ├── stores/           # Zustand state management
│   │   └── types/            # TypeScript type definitions
│   ├── main.js               # Electron main process
│   └── package.json
├── PathFinder/               # Python path planning backend
│   ├── main.py               # FastAPI server
│   ├── world.py              # Grid and mine state
│   ├── controllers/          # Path computation algorithms
│   └── events.py             # Mission event definitions
├── Arduino/                  # Embedded firmware (PlatformIO)
│   ├── src/main.cpp          # Hardware control logic
│   └── platformio.ini        # Build configuration
├── Diagrams/                 # Architecture diagrams (PlantUML)
├── ARCHITECTURE.md           # System design documentation
├── IMPLEMENTATION.md         # Feature implementation details
└── README.md                 # This file
```

## Quick Start

### Mission Controller

```bash
cd minefinder-web
npm install
npm run electron-dev    # Development mode with hot reload
npm run build          # Production build
```

### PathFinder Backend

```bash
cd PathFinder
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install fastapi uvicorn
python main.py
```

### Hardware Firmware

```bash
cd Arduino
pio run -t upload  # Requires PlatformIO CLI
```

## Development Guide

### Communication Protocol

The system uses a message-based protocol for coordination between components:

**Mission Start Message:**
```json
{
  "type": "mission_start",
  "mission_id": "uuid",
  "start": {"x_cm": 0, "y_cm": 0, "x_m": 0.0, "y_m": 0.0},
  "goal": {"x_cm": 50, "y_cm": 30, "x_m": 5.0, "y_m": 3.0},
  "parameters": {
    "altitude_m": 5.0,
    "speed_ms": 2.0,
    "pattern": "grid"
  }
}
```

**Detection Message:**
```json
{
  "type": "drone_scan",
  "position": {"x_cm": 25, "y_cm": 15, "x_m": 2.5, "y_m": 1.5},
  "confidence": 0.85,
  "sensor_id": "drone_01",
  "timestamp": 1699000000000
}
```

### Adding New Hardware Transports

Implement the `CommsAdapter` interface in `minefinder-web/src/services/comms/`:

```typescript
export class LoRaCommsAdapter extends BaseCommsAdapter {
  async initialize(): Promise<void> {
    // Setup LoRa module connection
    // Configure frequency, spreading factor, bandwidth
  }
  
  protected async sendRaw(data: Uint8Array | string): Promise<void> {
    // Transmit via LoRa radio
  }
  
  // Setup receive handler for incoming packets
}
```

Register in `CommsAdapterFactory.create()` and configure via `TransportConfig`.

### Coordinate System

The system uses dual coordinate systems:

**Grid Coordinates (cm):** High-precision integer coordinates for detection positioning.
**Metric Coordinates (m):** Real-world measurements for path planning.
**GPS Coordinates (lat/lon):** Absolute positioning for hardware integration.

Conversion between systems is handled by the coordinate service layer (see ARCHITECTURE.md for GPS integration details).

## Development

### Contributing

This is an academic project. If you're part of the project team, please follow these guidelines:
- Create feature branches for new work
- Write clear commit messages
- Document your changes
- Coordinate with team members

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Course instructors and mentors
- Team members and collaborators

## Contact

For questions or inquiries about this project, please contact the project team through the course communication channels.

---

*This project is part of an academic course and is under active development.*
