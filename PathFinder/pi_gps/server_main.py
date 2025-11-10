#!/usr/bin/env python3
"""
Pi GPS Server entrypoint
Usage on Pi:
  python3 -m pi_gps.server_main --port /dev/serial0 --baud 9600 --telemetry-hz 5

This starts the base JSONL server, registers available controllers, and
serves forever. The Electron app connects over serial and selects/configures
controllers via the protocol.
"""
from __future__ import annotations
import argparse
import sys
import logging
from base_server import PiBaseServer, ServerConfig
from controllers.gps_sim import GPSSimController
from controllers.gps_real import GPSRealController


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Pi GPS Server")
    p.add_argument("--port", default="/dev/serial0", help="Serial port device path")
    p.add_argument("--baud", type=int, default=9600, help="Serial baud rate")
    p.add_argument("--telemetry-hz", type=float, default=5.0, help="Telemetry rate (Hz)")
    p.add_argument("--log-level", default="INFO", choices=["DEBUG","INFO","WARNING","ERROR","CRITICAL"], help="Logging level (default: INFO)")
    p.add_argument("--verbose", action="store_true", help="Enable very verbose (DEBUG) logging")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)

    # Configure logging
    level = logging.DEBUG if args.verbose else getattr(logging, str(args.log_level).upper(), logging.INFO)
    logging.basicConfig(level=level, stream=sys.stderr, format='[%(asctime)s] %(levelname)s %(name)s: %(message)s')
    log = logging.getLogger(__name__)
    log.info("Starting Pi GPS server")

    cfg = ServerConfig(port=args.port, baud=args.baud, telemetry_hz=args.telemetry_hz)
    try:
        server = PiBaseServer(cfg)
    except Exception as e:
        log.error("Failed to open serial: %s", e)
        print(f"[PiGPS] failed to open serial: {e}")
        return 2

    # Register controllers
    server.register_controller("gps_sim", GPSSimController)
    server.register_controller("gps_real", GPSRealController)
    log.info("Registered controllers: %s", list(server.controllers.keys()))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Interrupted by user")
    finally:
        server.close()
        log.info("Server stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
