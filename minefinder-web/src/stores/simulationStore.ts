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
  detected?: boolean;  // True if drone has detected this mine
}

interface SimulationState {
  enabled: boolean;
  simulated_speed_ms: number; // flight speed for simulation on the Pi
  mine_buffer_m: number;      // default 3m (configurable)
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
  markMineDetected: (gps: GPSPoint) => void;  // Mark mine as detected (changes color)
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  enabled: false,
  simulated_speed_ms: 1.5,
  mine_buffer_m: 2,  // 2m total safe zone (1.5m circumvent + 0.5m path)
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
  
  markMineDetected: (gps: GPSPoint) => set((state) => ({
    mines: state.mines.map(mine => {
      // Check if this mine matches the detected GPS (within 5m tolerance)
      const latDiff = Math.abs(mine.gps.latitude - gps.latitude);
      const lonDiff = Math.abs(mine.gps.longitude - gps.longitude);
      const distance = Math.sqrt(latDiff * latDiff * 111320 * 111320 + lonDiff * lonDiff * 111320 * 111320);
      if (distance < 5) {
        return { ...mine, detected: true };
      }
      return mine;
    })
  })),
}));
