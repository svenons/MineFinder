/**
 * Telemetry Store
 * - Tracks live telemetry coming from the Pi controllers via serial JSONL.
 * - Stores drone position (GPS), active/planned path, and travelled path.
 */
import { create } from 'zustand';

export interface GPSPoint {
  latitude: number;
  longitude: number;
}

export interface TelemetryFrame {
  pos_gps: GPSPoint;
  path_travelled_gps?: GPSPoint[];
  path_active_gps?: GPSPoint[];
  speed_ms?: number;
  ts?: number;
}

export interface ControllerDescriptor {
  id: string;
  name: string;
  capabilities: string[];
}

interface TelemetryState {
  connected: boolean;
  port?: string;
  baud?: number;

  controllers: ControllerDescriptor[];
  selectedControllerId?: string;

  droneGps?: GPSPoint;
  plannedPathGps: GPSPoint[];
  travelledPathGps: GPSPoint[];
  lastSpeedMs?: number;
  lastTs?: number;

  setConnected: (connected: boolean, info?: { port?: string; baud?: number }) => void;
  setControllers: (controllers: ControllerDescriptor[]) => void;
  selectController: (id: string) => void;

  ingestTelemetry: (frame: TelemetryFrame) => void;
  setPathActive: (path: GPSPoint[]) => void;
  appendTravelled: (pts: GPSPoint[]) => void;
  reset: () => void;
}

const MAX_TRAVELLED_POINTS = 10000; // cap to avoid memory growth

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  connected: false,
  controllers: [],
  plannedPathGps: [],
  travelledPathGps: [],

  setConnected: (connected, info) => set({ connected, port: info?.port, baud: info?.baud }),

  setControllers: (controllers) => set({ controllers }),

  selectController: (id) => set({ selectedControllerId: id }),

  ingestTelemetry: (frame) => set((state) => {
    const travelled = frame.path_travelled_gps ?? state.travelledPathGps;
    const active = frame.path_active_gps ?? state.plannedPathGps;
    // Cap travelled points length
    let newTravelled = travelled;
    if (newTravelled.length > MAX_TRAVELLED_POINTS) {
      newTravelled = newTravelled.slice(newTravelled.length - MAX_TRAVELLED_POINTS);
    }
    return {
      droneGps: frame.pos_gps ?? state.droneGps,
      travelledPathGps: newTravelled,
      plannedPathGps: active,
      lastSpeedMs: frame.speed_ms ?? state.lastSpeedMs,
      lastTs: frame.ts ?? state.lastTs,
    };
  }),

  setPathActive: (path) => set({ plannedPathGps: path }),

  appendTravelled: (pts) => set((state) => {
    const combined = state.travelledPathGps.concat(pts);
    return { travelledPathGps: combined.slice(-MAX_TRAVELLED_POINTS) };
  }),

  reset: () => set({
    droneGps: undefined,
    plannedPathGps: [],
    travelledPathGps: [],
    lastSpeedMs: undefined,
    lastTs: undefined,
  }),
}));
