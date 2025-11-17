import { piSerialBridge } from './PiSerialBridge';
import type { InboundMsg, OutboundMsg, GPSPoint } from './types';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useMissionStore } from '../../stores/missionStore';
import { useDetectionStore } from '../../stores/detectionStore';
import type { DetectionEvent } from '../../types/mission.types';

/**
 * PiControllerService
 * Manages protocol with the Pi base server over serial JSONL.
 * Handles connect/hello/identify, controller selection, configure,
 * simulation mines, mission start/stop, and telemetry ingestion.
 */
export class PiControllerService {
  private connected = false;
  private lineUnsub: (() => void) | null = null;
  private statusUnsub: (() => void) | null = null;
  private origin: { lat: number; lon: number } | null = null;
  private metresPerCm: number = 0.01;  // Default 1cm = 0.01m
  private readonly METERS_PER_DEGREE_LAT = 111320;  // Earth radius approximation

  async connect(port: string, baud: number = 9600) {
    // Subscribe to status & lines first
    this.statusUnsub?.();
    this.statusUnsub = piSerialBridge.onStatus((st) => {
      useTelemetryStore.getState().setConnected(!!st.connected, { port: st.port, baud: st.baud });
      this.connected = !!st.connected;
    });
    this.lineUnsub?.();
    this.lineUnsub = piSerialBridge.onLine((line) => this.handleLine(line));

    const res = await piSerialBridge.open(port, baud);
    if (!res.success) throw new Error(res.error || 'failed to open serial');
    await this.send({ type: 'hello', role: 'client', app: 'MineFinder', version: 1 });
  }

  async disconnect() {
    this.lineUnsub?.();
    this.statusUnsub?.();
    this.lineUnsub = null;
    this.statusUnsub = null;
    await piSerialBridge.close();
    this.connected = false;
    useTelemetryStore.getState().setConnected(false);
  }

  async send(msg: OutboundMsg) {
    return piSerialBridge.writeLine({ ...msg });
  }

  async selectController(id: string) {
    await this.send({ type: 'select_controller', id });
    useTelemetryStore.getState().selectController(id);
  }

  async configure(origin: { lat: number; lon: number; alt?: number }, metres_per_cm: number, options?: {
    simulate?: boolean;
    simulated_speed_ms?: number;
    mine_buffer_m?: number;
    telemetry_hz?: number;
  }) {
    // Store for GPS to grid conversion
    this.origin = { lat: origin.lat, lon: origin.lon };
    this.metresPerCm = metres_per_cm;
    
    const simulate = !!options?.simulate;
    await this.send({
      type: 'configure',
      origin_gps: origin,
      metres_per_cm,
      simulate,
      simulated_speed_ms: options?.simulated_speed_ms,
      mine_buffer_m: options?.mine_buffer_m,
      telemetry_hz: options?.telemetry_hz,
    });

    if (simulate) {
      // Push current simulation mines
      const mines = useSimulationStore.getState().mines;
      const mines_gps = mines.map(m => ({ lat: m.gps.latitude, lon: m.gps.longitude, radius_m: m.radius_m }));
      await this.send({ type: 'sim_mines', mines_gps });
    }
  }

  async startMission(start: GPSPoint, goal: GPSPoint) {
    console.log('[PiControllerService] startMission called with start:', start, 'goal:', goal);
    
    // Always sync simulation mines before starting mission (in case user added/removed mines)
    const selectedId = useTelemetryStore.getState().selectedControllerId;
    const simulate = useSimulationStore.getState().enabled;
    if (selectedId && simulate) {
      const mines = useSimulationStore.getState().mines;
      const mines_gps = mines.map(m => ({ lat: m.gps.latitude, lon: m.gps.longitude, radius_m: m.radius_m }));
      console.log('[PiControllerService] Sending sim_mines with', mines_gps.length, 'mines');
      await this.send({ type: 'sim_mines', mines_gps });
      console.log('[PiControllerService] sim_mines sent successfully');
    }
    
    console.log('[PiControllerService] Sending mission_start');
    await this.send({ type: 'mission_start', start_gps: start, goal_gps: goal });
    console.log('[PiControllerService] mission_start sent successfully');
  }

  async stopMission() {
    await this.send({ type: 'mission_stop' });
  }

  private handleLine(line: string) {
    let msg: InboundMsg | null = null;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof (msg as any).type !== 'string') return;

    switch ((msg as any).type) {
      case 'identify': {
        const m = msg as any;
        const controllers = (m.controllers || []).map((c: any) => ({ id: String(c.id), name: String(c.name), capabilities: Array.isArray(c.capabilities) ? c.capabilities : [] }));
        useTelemetryStore.getState().setControllers(controllers);
        break;
      }
      case 'controller_list': {
        const m = msg as any;
        const controllers = (m.controllers || []).map((c: any) => ({ id: String(c.id), name: String(c.name), capabilities: Array.isArray(c.capabilities) ? c.capabilities : [] }));
        useTelemetryStore.getState().setControllers(controllers);
        break;
      }
      case 'controller_selected': {
        const m = msg as any;
        if (m.id) useTelemetryStore.getState().selectController(String(m.id));
        break;
      }
      case 'path_update': {
        const m = msg as any;
        const pts = (m.waypoints_gps || []).map((p: any) => ({ latitude: Number(p.lat), longitude: Number(p.lon) }));
        useTelemetryStore.getState().setPathActive(pts);
        break;
      }
      case 'telemetry': {
        const m = msg as any;
        const frame = {
          pos_gps: m.pos_gps ? { latitude: Number(m.pos_gps.lat), longitude: Number(m.pos_gps.lon) } : undefined,
          path_travelled_gps: Array.isArray(m.path_travelled_gps) ? m.path_travelled_gps.map((p: any) => ({ latitude: Number(p.lat), longitude: Number(p.lon) })) : undefined,
          path_active_gps: Array.isArray(m.path_active_gps) ? m.path_active_gps.map((p: any) => ({ latitude: Number(p.lat), longitude: Number(p.lon) })) : undefined,
          speed_ms: typeof m.speed_ms === 'number' ? m.speed_ms : undefined,
          ts: typeof m.ts === 'number' ? m.ts : undefined,
        } as any;
        useTelemetryStore.getState().ingestTelemetry(frame);
        break;
      }
      case 'mine_detected': {
        const m = msg as any;
        if (m.at_gps && this.origin) {
          // Convert GPS to grid coordinates
          const gpsLat = Number(m.at_gps.lat);
          const gpsLon = Number(m.at_gps.lon);
          
          // Calculate meters from origin
          const latDelta = gpsLat - this.origin.lat;
          const y_m = latDelta * this.METERS_PER_DEGREE_LAT;
          
          const lonDelta = gpsLon - this.origin.lon;
          const latRad = (this.origin.lat * Math.PI) / 180;
          const metersPerDegreeLon = this.METERS_PER_DEGREE_LAT * Math.cos(latRad);
          const x_m = lonDelta * metersPerDegreeLon;
          
          // Convert to cm
          const x_cm = Math.round(x_m / this.metresPerCm);
          const y_cm = Math.round(y_m / this.metresPerCm);
          
          const detectionEvent: DetectionEvent = {
            position: {
              x_cm,
              y_cm,
              x_m,
              y_m,
              gps: {
                latitude: gpsLat,
                longitude: gpsLon,
              },
            },
            confidence: typeof m.confidence === 'number' ? m.confidence : 0.95,
            sensor_id: m.mine_id || 'pi_sensor',
            timestamp: Date.now(),
          };
          
          console.log('[PiControllerService] Mine detected:', detectionEvent);
          useDetectionStore.getState().processDetection(detectionEvent);
          
          // Mark the simulated mine as detected (changes color from orange to red)
          useSimulationStore.getState().markMineDetected({
            latitude: gpsLat,
            longitude: gpsLon,
          });
        }
        break;
      }
      case 'nav_done': {
        // Mission navigation completed - automatically mark as completed
        const activeMission = useMissionStore.getState().getActiveMission();
        if (activeMission) {
          console.log('[PiControllerService] Navigation complete, auto-completing mission:', activeMission.mission_id);
          useMissionStore.getState().completeMission(activeMission.mission_id);
        }
        break;
      }
      case 'status':
      case 'error':
      default:
        // For now, ignore; optionally could forward to a toast system
        break;
    }
  }
}

export const piControllerService = new PiControllerService();
