/**
 * Mission Store
 * 
 * Zustand state management for mission lifecycle and planning.
 * Handles mission creation, status transitions, and historical tracking.
 * 
 * State Flow:
 * Draft (start/goal positions) → Create Mission → Start → Active → Complete/Abort
 * 
 * Only one mission can be active at a time. Historical missions are retained
 * for analysis and replay functionality.
 */

import { create } from 'zustand';
import type { Mission, Position } from '../types/mission.types';
import { MissionProtocolService } from '../services/MissionProtocol';

/**
 * Mission store state and actions interface
 */
interface MissionState {
  // Active mission tracking
  activeMission: Mission | null;        // Currently executing mission or null
  missionHistory: Mission[];            // Completed/aborted missions for history
  
  // Draft positions for mission planning (before creation)
  draftStart: Position | null;          // Temporary start position (A)
  draftGoal: Position | null;           // Temporary goal position (B)
  
  // Draft manipulation actions
  setDraftStart: (position: Position) => void;
  setDraftGoal: (position: Position) => void;
  clearDraft: () => void;
  
  // Mission lifecycle actions
  createMission: (params: {
    start: Position;
    goal: Position;
    corridor?: { width_cm: number; height_cm: number };
    metres_per_cm: number;
  }) => Mission;
  
  startMission: (mission: Mission) => void;          // Transition to active state
  completeMission: (missionId: string) => void;      // Mark as successfully completed
  abortMission: (missionId: string) => void;         // Emergency termination
  
  // Query actions
  getMissionById: (missionId: string) => Mission | null;
  getActiveMission: () => Mission | null;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  activeMission: null,
  missionHistory: [],
  draftStart: null,
  draftGoal: null,

  setDraftStart: (position) => set({ draftStart: position }),
  
  setDraftGoal: (position) => set({ draftGoal: position }),
  
  clearDraft: () => set({ draftStart: null, draftGoal: null }),

  createMission: (params) => {
    const mission: Mission = {
      mission_id: MissionProtocolService.generateMissionId(),
      start: params.start,
      goal: params.goal,
      corridor: params.corridor,
      metres_per_cm: params.metres_per_cm,
      parameters: {
        confidence_threshold: 0.5,
        comm_mode: 'realtime',
        pattern: 'corridor',
      },
      created_at: Date.now(),
      status: 'pending',
    };

    set((state) => ({
      missionHistory: [...state.missionHistory, mission],
      activeMission: mission, // Set as active immediately
      draftStart: null, // Clear draft positions
      draftGoal: null,
    }));

    return mission;
  },

  startMission: (mission) => {
    set((state) => ({
      activeMission: { ...mission, status: 'active' },
      missionHistory: state.missionHistory.map((m) =>
        m.mission_id === mission.mission_id ? { ...m, status: 'active' } : m
      ),
    }));
  },

  completeMission: (missionId) => {
    set((state) => {
      const isCurrentMission = state.activeMission?.mission_id === missionId;
      return {
        activeMission: isCurrentMission ? null : state.activeMission, // Clear active mission
        missionHistory: state.missionHistory.map((m) =>
          m.mission_id === missionId ? { ...m, status: 'completed' } : m
        ),
        draftStart: null, // Clear any draft positions
        draftGoal: null,
      };
    });
  },

  abortMission: (missionId) => {
    set((state) => {
      const isCurrentMission = state.activeMission?.mission_id === missionId;
      return {
        activeMission: isCurrentMission ? null : state.activeMission, // Clear active mission
        missionHistory: state.missionHistory.map((m) =>
          m.mission_id === missionId ? { ...m, status: 'aborted' } : m
        ),
        draftStart: null, // Clear any draft positions
        draftGoal: null,
      };
    });
  },

  getMissionById: (missionId) => {
    return get().missionHistory.find((m) => m.mission_id === missionId) || null;
  },

  getActiveMission: () => {
    return get().activeMission;
  },
}));
