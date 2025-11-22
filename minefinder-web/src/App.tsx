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

import { useState, useEffect } from 'react';
import './App.css';

// Components
import { Grid } from './components/Grid';
import { MissionForm } from './components/MissionForm';
import { AttachmentSelector } from './components/AttachmentSelector';
import { AlgorithmSelector } from './components/AlgorithmSelector';
import { MissionDashboard } from './components/MissionDashboard';
import { OptionsPanel } from './components/OptionsPanel';
import { SimulationPanel } from './components/SimulationPanel';
import { ThemeToggle } from './components/ThemeToggle';

// Stores (Zustand state management)
import { useMissionStore } from './stores/missionStore';
import { useDetectionStore } from './stores/detectionStore';
import { useThemeStore } from './stores/themeStore';

// Services
import { PathFinderService } from './services/PathFinderService';
import { piControllerService } from './services/pi/PiControllerService';
import { useTelemetryStore } from './stores/telemetryStore';
import { useSimulationStore } from './stores/simulationStore';

function App() {
  const tel = useTelemetryStore();
  const sim = useSimulationStore();
  const { theme } = useThemeStore();
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
  const { detections, processDetection, clearDetections } = useDetectionStore();

  // Local UI state
  const [clickMode, setClickMode] = useState<'start' | 'goal'>('start');

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
    
    console.log('[App] handleCreateMission - checking conditions:', {
      connected: useTelemetryStore.getState().connected,
      selectedAlgorithmId: useTelemetryStore.getState().selectedAlgorithmId,
      hasStartGps: !!startGps,
      hasGoalGps: !!goalGps,
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
    }

    // Transition mission to active state
    startMission(mission);

    // Reset UI to start mode for next mission planning
    setClickMode('start');
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '24px' }}>MineFinder</h1>
              <div style={{ fontSize: '12px', color: 'var(--color-text-disabled)', marginTop: '4px' }}>
                Mission Controller
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>

        <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <OptionsPanel />
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
          />
        </div>

        <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <SimulationPanel />
        </div>
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
    </div>
  );
}

export default App;
