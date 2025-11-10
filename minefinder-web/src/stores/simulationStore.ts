/**
 * Simulation Store
 * - Tracks simulation mode, parameters, and dummy mines the user places.
 */
import { create } from 'zustand';

export interface GPSPoint {
  latitude: number;
  longitude: number;
}

export interface SimulatedMine {
  id: string;
  gps: GPSPoint;
  /** Radius in meters for avoidance buffer (default 10m) */
  radius_m: number;
}

interface SimulationState {
  enabled: boolean;
  simulated_speed_ms: number; // flight speed for simulation on the Pi
  mine_buffer_m: number;      // default 10m (configurable)
  telemetry_hz: number;       // desired telemetry rate (Hz)

  // UI state: placing mines mode
  placingMines: boolean;

  mines: SimulatedMine[];

  setEnabled: (v: boolean) => void;
  setSimulatedSpeed: (v: number) => void;
  setMineBuffer: (v: number) => void;
  setTelemetryHz: (v: number) => void;

  setPlacingMines: (v: boolean) => void;

  addMine: (mine: Omit<SimulatedMine, 'id'>) => void;
  removeMine: (id: string) => void;
  clearMines: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  enabled: false,
  simulated_speed_ms: 1.5,
  mine_buffer_m: 10,
  telemetry_hz: 5,

  placingMines: false,
  mines: [],

  setEnabled: (v) => set({ enabled: v }),
  setSimulatedSpeed: (v) => set({ simulated_speed_ms: Math.max(0, v) }),
  setMineBuffer: (v) => set((state) => ({ mine_buffer_m: Math.max(0, v), mines: state.mines.map(m => ({ ...m, radius_m: Math.max(0, v) })) })), 
  setTelemetryHz: (v) => set({ telemetry_hz: Math.max(0.2, v) }),

  setPlacingMines: (v) => set({ placingMines: v }),

  addMine: (mine) => {
    const id = `mine_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({ mines: [...state.mines, { id, ...mine }] }));
  },
  removeMine: (id) => set((state) => ({ mines: state.mines.filter(m => m.id !== id) })),
  clearMines: () => set({ mines: [] }),
}));
