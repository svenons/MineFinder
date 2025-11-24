/**
 * Main Application Component
 * 
 * Root component orchestrating the Mission Controller interface.
 * Manages application-level state, Pi serial communication lifecycle,
 * and coordinates interaction between mission planning, detection
 * aggregation, and hardware communication subsystems.
 * 
 * Architecture:
 * - Left sidebar: Connection, attachment/algorithm selection, mission config, simulation
 * - Top bar: Active mission dashboard and controls
 * - Center: Interactive grid with satellite imagery and detections
 * - Bottom bar: Status indicators and grid metadata
 * 
 * State Flow:
 * Hardware (Pi) → Serial JSONL → PiControllerService → Store → UI
 */

import { useState, useEffect, useRef } from 'react';
import './App.css';

// Components
import { Grid } from './components/Grid';
import { MissionForm } from './components/MissionForm';
import { AttachmentSelector } from './components/AttachmentSelector';
import { AlgorithmSelector } from './components/AlgorithmSelector';
import { MissionDashboard } from './components/MissionDashboard';
import { SimulationPanel } from './components/SimulationPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { SettingsModal } from './components/SettingsModal';
import { MissionHistory } from './components/MissionHistory';

// Stores (Zustand state management)
import { useMissionStore } from './stores/missionStore';
import type { Mission } from './types/mission.types';
import { useDetectionStore } from './stores/detectionStore';
import { useThemeStore } from './stores/themeStore';

// Services
import { PathFinderService } from './services/PathFinderService';
import { DetectionAggregator } from './services/DetectionAggregator';
import { piControllerService } from './services/pi/PiControllerService';
import { useTelemetryStore } from './stores/telemetryStore';
import { useSimulationStore } from './stores/simulationStore';
import { CoordinateService } from './services/CoordinateService';

function App() {
  const tel = useTelemetryStore();
  const sim = useSimulationStore();
  const { theme } = useThemeStore();
  const animationIntervalRef = useRef<number | null>(null);
  
  // Mission state management via Zustand stores
  const {
    activeMission,      // Currently executing mission or null
    draftStart,         // Draft start position before mission creation
    draftGoal,          // Draft goal position before mission creation
    setDraftStart,
    setDraftGoal,
    clearDraft,
    createMission,      // Creates mission from draft positions
    startMission,       // Transitions mission to active state
    completeMission,    // Marks mission as completed
    abortMission,       // Emergency mission termination
  } = useMissionStore();

  // Detection aggregation and deduplication
  const { detections, clearDetections } = useDetectionStore();

  // Local UI state
  const [clickMode, setClickMode] = useState<'start' | 'goal'>('start');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Grid configuration defines mission area dimensions
  const gridConfig = {
    width_cm: 50,        // 50cm wide grid
    height_cm: 30,       // 30cm tall grid
    metres_per_cm: 0.01,  // 1 cm represents 0.01 m (true-to-scale)
  };

  // Handle user clicks on grid cells during mission planning
  const handleCellClick = (position: NonNullable<typeof draftStart>) => {
    // Disable interaction during active missions
    if (activeMission && activeMission.status === 'active') {
      return;
    }

    // Set start or goal position based on current mode
    if (clickMode === 'start') {
      setDraftStart(position);
      setClickMode('goal');  // Auto-advance to goal selection for UX efficiency
    } else {
      setDraftGoal(position);
    }
  };

  // Create mission from draft positions and send to hardware
  const handleCreateMission = async () => {
    console.log('[App] *** handleCreateMission CALLED ***', { draftStart, draftGoal });
    if (!draftStart || !draftGoal) {
      console.log('[App] Missing start or goal, aborting');
      return;
    }

    // Clear previous mission detections
    clearDetections();

    // Create mission object with all required parameters
    const mission = createMission({
      start: draftStart,
      goal: draftGoal,
      corridor: gridConfig,
      metres_per_cm: gridConfig.metres_per_cm,
    });

    // If Pi serial is connected and a controller is selected, send configure and start to Pi
    const startGps = draftStart.gps;
    const goalGps = draftGoal.gps;
    const isSimulation = sim.enabled && tel.selectedAttachmentId === 'simulation';
    
    console.log('[App] handleCreateMission - checking conditions:', {
      connected: useTelemetryStore.getState().connected,
      selectedAlgorithmId: useTelemetryStore.getState().selectedAlgorithmId,
      selectedAttachmentId: tel.selectedAttachmentId,
      hasStartGps: !!startGps,
      hasGoalGps: !!goalGps,
      isSimulation,
    });
    
    if (useTelemetryStore.getState().connected && useTelemetryStore.getState().selectedAlgorithmId && startGps && goalGps) {
      console.log('[App] Conditions met, sending to Pi');
      try {
        // Use start as origin if none configured elsewhere
        await piControllerService.configure({ lat: startGps.latitude, lon: startGps.longitude }, gridConfig.metres_per_cm, {
          simulate: useSimulationStore.getState().enabled,
          simulated_speed_ms: useSimulationStore.getState().simulated_speed_ms,
          mine_buffer_m: useSimulationStore.getState().mine_buffer_m,
          telemetry_hz: useSimulationStore.getState().telemetry_hz,
        });
        await piControllerService.startMission({ lat: startGps.latitude, lon: startGps.longitude }, { lat: goalGps.latitude, lon: goalGps.longitude });
      } catch (e) {
        console.warn('Pi mission start failed:', e);
      }
    } else if (isSimulation && tel.selectedAlgorithmId) {
      // Run local simulation if simulation attachment is selected
      console.log('[App] Running local simulation with algorithm:', tel.selectedAlgorithmId);
      try {
        await runLocalSimulation(mission);
      } catch (e) {
        console.error('Local simulation failed:', e);
        alert(`Simulation failed: ${e}`);
      }
    }

    // Transition mission to active state
    startMission(mission);

    // Reset UI to start mode for next mission planning
    setClickMode('start');
  };

  // Run local simulation (for simulation attachment)
  const runLocalSimulation = async (mission: Mission) => {
    console.log('[App] Starting local simulation...');
    
    // Create detection aggregator and add simulated mines
    const aggregator = new DetectionAggregator();
    const startGps = mission.start.gps;
    const goalGps = mission.goal.gps;
    
    if (!startGps || !goalGps) {
      throw new Error('Missing GPS coordinates');
    }

    // Add simulated mines using their stored grid coordinates
    sim.mines.forEach(mine => {
      if (mine.gps && mine.x_cm !== undefined && mine.y_cm !== undefined) {
        aggregator.processDetection({
          position: {
            x_cm: mine.x_cm,
            y_cm: mine.y_cm,
            x_m: mine.x_cm * gridConfig.metres_per_cm,
            y_m: mine.y_cm * gridConfig.metres_per_cm,
            gps: mine.gps,
          },
          confidence: 0.95,
          timestamp: Date.now(),
          sensor_id: 'simulated',
        });
      }
    });
    
    console.log('[App] Added', sim.mines.length, 'mines to PathFinder');
    
    // Run PathFinder to compute safe path
    try {
      const result = await PathFinderService.runSimulation(mission, aggregator, 0.5);
      
      console.log('[App] PathFinder result:', result);
      
      if (!result.success) {
        console.error('[App] PathFinder failed:', result.error || result.stderr);
        throw new Error(result.error || result.stderr || 'PathFinder failed to compute path');
      }
      
      if (!result.events || result.events.length === 0) {
        throw new Error('PathFinder returned no events');
      }

      // Extract drone position events (the actual flight path with detections)
      const droneEvents = result.events.filter((e: any) => e.type === 'drone_position');
      const mineEvents = result.events.filter((e: any) => e.type === 'mine_detected');
      
      console.log('[App] Received', droneEvents.length, 'position events and', mineEvents.length, 'mine detections');
      
      if (droneEvents.length === 0) {
        throw new Error('No drone positions in simulation');
      }

      // Convert drone positions to GPS path
      const coordService = new CoordinateService(startGps, gridConfig.metres_per_cm);
      const flightPath = droneEvents.map((e: any) => 
        coordService.gridToGPS(e.data.x_cm, e.data.y_cm)
      );

      // Don't set path_active yet - we'll build it as we animate
      // tel.setPathActive(flightPath);
      
      // Process detected mines and add them progressively during animation
      const detectedMinesGps = mineEvents.map((e: any) => ({
        ...coordService.gridToGPS(e.data.x_cm, e.data.y_cm),
        ts: e.ts
      }));

      // Start animating drone along the flight path (this will show the exploration)
      animateDroneAlongPath(flightPath, detectedMinesGps);
    } catch (error: any) {
      console.error('[App] PathFinder execution failed:', error);
      throw new Error(error.message || 'PathFinder execution failed');
    }
  };

  // Animate drone movement along path
  const animateDroneAlongPath = (
    pathGps: Array<{latitude: number, longitude: number}>,
    detectedMinesWithTs: Array<{latitude: number, longitude: number, ts: number}>
  ) => {
    if (pathGps.length === 0) return;

    // Clear any existing animation
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    let currentIndex = 0;
    const hz = sim.telemetry_hz || 10; // Default 10Hz if not set
    const intervalMs = 1000 / hz;

    const stepAnimation = () => {
      if (currentIndex >= pathGps.length) {
        if (animationIntervalRef.current) {
          clearInterval(animationIntervalRef.current);
          animationIntervalRef.current = null;
        }
        console.log('[App] Simulation complete - reached goal');
        return;
      }

      // Update drone position
      const pos = pathGps[currentIndex];
      
      // Build path progressively (showing exploration as it happens)
      const currentPath = pathGps.slice(0, currentIndex + 1);
      
      tel.ingestTelemetry({
        pos_gps: pos,
        path_active_gps: currentPath, // Only show path up to current position
        speed_ms: sim.simulated_speed_ms,
        ts: Date.now(),
      });

      // Append to travelled path
      tel.appendTravelled([pos]);

      // Show detected mines when we reach their timestamp
      detectedMinesWithTs.forEach(mine => {
        if (mine.ts === currentIndex) {
          console.log('[Animation] Mine detected at step', currentIndex, mine);
          // Mark corresponding simulated mine as detected
          sim.markMineDetected(mine);
        }
      });

      currentIndex++;
    };

    animationIntervalRef.current = setInterval(stepAnimation, intervalMs) as any;
  };

  // Handle mission start
  const handleStartMission = async () => {
    if (!activeMission) return;
    const s = activeMission.start.gps;
    const g = activeMission.goal.gps;
    if (useTelemetryStore.getState().connected && useTelemetryStore.getState().selectedAlgorithmId && s && g) {
      try {
        await piControllerService.startMission({ lat: s.latitude, lon: s.longitude }, { lat: g.latitude, lon: g.longitude });
      } catch (e) {
        console.warn('Pi start failed:', e);
      }
    }
    startMission(activeMission);
  };

  // Handle mission complete/save
  const handleCompleteMission = () => {
    if (!activeMission) return;
    
    // If already completed, this is a 'Save' action - clear the mission
    if (activeMission.status === 'completed') {
      // Mission is saved in history, just clear the active slot
      useMissionStore.setState({ activeMission: null, draftStart: null, draftGoal: null });
      setClickMode('start');
    } else {
      // Manual completion (if nav_done didn't fire for some reason)
      completeMission(activeMission.mission_id);
    }
  };

  // Handle mission abort
  const handleAbortMission = () => {
    if (!activeMission) return;
    
    // Stop any running animation
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
      console.log('[App] Animation stopped due to abort');
    }
    
    // Notify Pi server if connected
    if (useTelemetryStore.getState().connected) {
      try { piControllerService.stopMission(); } catch {}
    }
    abortMission(activeMission.mission_id);
    // Reset to start mode for next mission
    setClickMode('start');
  };

  // Export to PathFinder
  const handleExportPathFinder = async () => {
    if (!activeMission) return;

    try {
      const result = await PathFinderService.saveMissionExport(
        activeMission,
        useDetectionStore.getState().aggregator,
        0.5
      );

      if (result.success) {
        alert(`Mission exported to: ${result.path}`);
      } else {
        alert(`Export failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert(`Export error: ${error}`);
    }
  };

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Initialize simulation attachment if simulation mode is enabled
  useEffect(() => {
    if (sim.enabled) {
      tel.addAttachment({
        id: 'simulation',
        name: 'Simulation',
        algorithms: [
          {
            id: 'astar-backtrack',
            name: 'A* with Backtracking',
            capabilities: ['pathfinding', 'obstacle_avoidance'],
          },
          {
            id: 'scan-entire-field',
            name: 'Scan Entire Field',
            capabilities: ['coverage', 'systematic_scan'],
          },
        ],
      });
    }
  }, [sim.enabled]);

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>
      {/* Left Sidebar */}
      <div
        className="sidebar"
        style={{
          width: '320px',
          minWidth: '320px',
          borderRight: '1px solid var(--color-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px' }}>MineFinder</h1>
              <div style={{ fontSize: '12px', color: 'var(--color-text-disabled)', marginTop: '4px' }}>
                Mission Controller
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setHistoryOpen(true)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: 'var(--color-text)',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: 1,
                    justifyContent: 'center',
                    minWidth: 0,
                  }}
                  title="Mission History"
                >
                  <span style={{ fontSize: '16px' }}>📋</span>
                  <span>History</span>
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    color: 'var(--color-text)',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flex: 1,
                    justifyContent: 'center',
                    minWidth: 0,
                  }}
                  title="Settings"
                >
                  <span style={{ fontSize: '16px' }}>⚙️</span>
                  <span>Settings</span>
                </button>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>

        <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <AttachmentSelector />
        </div>

        <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <AlgorithmSelector />
        </div>

        <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <MissionForm
            startPosition={draftStart}
            goalPosition={draftGoal}
            mode={clickMode}
            onSetMode={setClickMode}
            onSetStart={setDraftStart}
            onSetGoal={setDraftGoal}
            onClear={() => {
              clearDraft();
              setClickMode('start'); // Reset to start mode
            }}
            onCreateMission={handleCreateMission}
            disabled={!!activeMission}
            simulationEnabled={sim.enabled}
            mineCount={sim.mines.length}
          />
        </div>

        {sim.enabled && (
          <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            <SimulationPanel />
          </div>
        )}
      </div>

      {/* Main Content */}
      <div
        className="main-content"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top Bar - Mission Dashboard */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <MissionDashboard
            mission={activeMission}
            detectionCount={detections.length}
            onStart={handleStartMission}
            onComplete={handleCompleteMission}
            onAbort={handleAbortMission}
            onExportPathFinder={handleExportPathFinder}
          />
        </div>

        {/* Grid Visualization */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '24px',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <Grid
            width_cm={gridConfig.width_cm}
            height_cm={gridConfig.height_cm}
            metres_per_cm={gridConfig.metres_per_cm}
            detections={detections}
            startPosition={activeMission ? activeMission.start : draftStart}
            goalPosition={activeMission ? activeMission.goal : draftGoal}
            onCellClick={handleCellClick}
            showGrid={true}
            disabled={activeMission?.status === 'active'}
          />
        </div>

        {/* Bottom Bar - Stats */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: 'var(--color-text-muted)',
          }}
        >
          <div>Detections: {detections.length}</div>
          {/* Show click mode indicator only when positions are not both set */}
          {(activeMission || (!draftStart || !draftGoal)) && (
            <div
              style={{
                padding: '6px 12px',
                backgroundColor: activeMission && activeMission.status === 'active' 
                  ? 'var(--color-background-elevated)' 
                  : clickMode === 'start' ? '#0a2a0a' : '#0a1a2a',
                border: `1px solid ${
                  activeMission && activeMission.status === 'active'
                    ? 'var(--color-text-disabled)'
                    : clickMode === 'start' ? 'var(--color-success)' : 'var(--color-info)'
                }`,
                borderRadius: '4px',
                fontWeight: 'bold',
                color: activeMission && activeMission.status === 'active'
                  ? 'var(--color-text-disabled)'
                  : clickMode === 'start' ? 'var(--color-success)' : 'var(--color-info)',
              }}
            >
              {activeMission && activeMission.status === 'active'
                ? 'Mission Active'
                : clickMode === 'start'
                ? 'Click to Set Start (A)'
                : 'Click to Set Goal (B)'}
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Mission History Modal */}
      {historyOpen && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
          onClick={() => setHistoryOpen(false)}
        >
          <div 
            style={{
              backgroundColor: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '20px' }}>Mission History</h2>
              <button 
                onClick={() => setHistoryOpen(false)}
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  fontSize: '24px', 
                  cursor: 'pointer',
                  padding: '0 8px',
                  color: 'var(--color-text)',
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: '-8px' }}>
              <MissionHistory 
                onSelectMission={(mission) => {
                  console.log('Selected mission:', mission);
                  // Could add functionality to view details or replay
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
