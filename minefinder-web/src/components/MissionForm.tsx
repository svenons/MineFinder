/**
 * Mission Form Component
 * 
 * User interface for planning autonomous demining missions by selecting
 * start and goal positions on the grid. Provides mode switching between
 * position selection and displays selected coordinates in multiple units.
 * 
 * Workflow:
 * 1. Select "Set Start (A)" or "Set Goal (B)" mode
 * 2. Click grid cell to set position
 * 3. Review coordinates in cm and meters
 * 4. Create mission to send to hardware attachments
 * 
 * Disabled during active missions to prevent parameter changes mid-flight.
 */

import type { Position } from '../types/mission.types';

/**
 * Component properties for mission configuration UI
 */
interface MissionFormProps {
  startPosition: Position | null;           // Current start position (A) or null if not set
  goalPosition: Position | null;            // Current goal position (B) or null if not set
  mode: 'start' | 'goal';                   // Current selection mode
  onSetMode: (mode: 'start' | 'goal') => void;  // Mode switch callback
  onSetStart: (position: Position) => void; // Start position setter
  onSetGoal: (position: Position) => void;  // Goal position setter
  onClear: () => void;                      // Clear both positions
  onCreateMission: () => void;              // Create and start mission
  disabled?: boolean;                       // Disable during active missions
}

export function MissionForm({
  startPosition,
  goalPosition,
  mode,
  onSetMode,
  onSetStart: _onSetStart,  // Prefixed with underscore because it's not used directly (handler pattern)
  onSetGoal: _onSetGoal,     // Prefixed with underscore because it's not used directly (handler pattern)
  onClear,
  onCreateMission,
  disabled = false,
}: MissionFormProps) {

  // Mission can only be created when both positions are set and no mission is active
  const canCreate = startPosition !== null && goalPosition !== null && !disabled;

  return (
    <div className="mission-form" style={{ padding: '16px' }}>
      <h3 style={{ marginTop: 0 }}>Mission Setup</h3>

      {/* Mode selector */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
          Click mode:
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onSetMode('start')}
            disabled={disabled}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: mode === 'start' ? '#e8f5e9' : 'var(--color-background-elevated)',
              border: mode === 'start' ? '2px solid var(--color-success)' : '1px solid var(--color-border)',
              color: mode === 'start' ? 'var(--color-success)' : 'var(--color-text)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              fontWeight: mode === 'start' ? 'bold' : 'normal',
            }}
          >
            {mode === 'start' ? '🟢 ' : ''}Set Start (A)
          </button>
          <button
            onClick={() => onSetMode('goal')}
            disabled={disabled}
            style={{
              flex: 1,
              padding: '8px',
              backgroundColor: mode === 'goal' ? '#e3f2fd' : 'var(--color-background-elevated)',
              border: mode === 'goal' ? '2px solid var(--color-info)' : '1px solid var(--color-border)',
              color: mode === 'goal' ? 'var(--color-info)' : 'var(--color-text)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              fontWeight: mode === 'goal' ? 'bold' : 'normal',
            }}
          >
            {mode === 'goal' ? '🔵 ' : ''}Set Goal (B)
          </button>
        </div>
      </div>

      {/* Position display */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            padding: '12px',
            backgroundColor: 'var(--color-background-hover)',
            borderRadius: '4px',
            marginBottom: '8px',
          }}
        >
          <div style={{ fontWeight: 'bold', color: 'var(--color-success)', marginBottom: '4px' }}>
            Start Position (A):
          </div>
          {startPosition ? (
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              {startPosition.gps
                ? `GPS: ${startPosition.gps.latitude.toFixed(6)}, ${startPosition.gps.longitude.toFixed(6)}`
                : 'GPS: —'}
            </div>
          ) : (
            <div style={{ fontSize: '14px', color: 'var(--color-text-disabled)', fontStyle: 'italic' }}>Not set</div>
          )}
        </div>

        <div
          style={{
            padding: '12px',
            backgroundColor: 'var(--color-background-hover)',
            borderRadius: '4px',
          }}
        >
          <div style={{ fontWeight: 'bold', color: 'var(--color-info)', marginBottom: '4px' }}>
            Goal Position (B):
          </div>
          {goalPosition ? (
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              {goalPosition.gps
                ? `GPS: ${goalPosition.gps.latitude.toFixed(6)}, ${goalPosition.gps.longitude.toFixed(6)}`
                : 'GPS: —'}
            </div>
          ) : (
            <div style={{ fontSize: '14px', color: 'var(--color-text-disabled)', fontStyle: 'italic' }}>Not set</div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onClear}
          disabled={disabled || (!startPosition && !goalPosition)}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: 'var(--color-background-elevated)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            cursor: disabled || (!startPosition && !goalPosition) ? 'not-allowed' : 'pointer',
            opacity: disabled || (!startPosition && !goalPosition) ? 0.5 : 1,
          }}
        >
          Clear
        </button>
        <button
          onClick={onCreateMission}
          disabled={!canCreate}
          style={{
            flex: 2,
            padding: '10px',
            backgroundColor: canCreate ? '#e8f5e9' : 'var(--color-background-elevated)',
            border: canCreate ? '2px solid var(--color-success)' : '1px solid var(--color-border)',
            color: canCreate ? 'var(--color-success)' : 'var(--color-text)',
            cursor: canCreate ? 'pointer' : 'not-allowed',
            opacity: canCreate ? 1 : 0.5,
            fontWeight: 'bold',
          }}
        >
          Create Mission
        </button>
      </div>

      {/* Instructions */}
      <div
        style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: 'var(--color-background-elevated)',
          borderRadius: '4px',
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '8px', color: 'var(--color-text)' }}>Instructions:</div>
        <ol style={{ margin: 0, paddingLeft: '20px' }}>
          <li>Select "Set Start (A)" or "Set Goal (B)" mode</li>
          <li>Click on the grid to set the position</li>
          <li>Select attachments to use</li>
          <li>Create and start the mission</li>
        </ol>
      </div>
    </div>
  );
}

// Helper function to connect to Grid component
export function useMissionFormWithGrid(
  onSetStart: (position: Position) => void,
  onSetGoal: (position: Position) => void,
  mode: 'start' | 'goal'
) {
  return (position: Position) => {
    if (mode === 'start') {
      onSetStart(position);
    } else {
      onSetGoal(position);
    }
  };
}
