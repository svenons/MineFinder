/**
 * Electron API type definitions
 * Matches preload.js exposed API
 */

import type { PathFinderWorldExport } from '../types/pathfinder.types';

export interface ElectronAPI {
  app: {
    getName: () => string;
    getPaths: () => Promise<{
      userData: string;
      projectRoot: string;
      pathFinder: string;
    }>;
  };
  
  pathFinder: {
    run: (
      worldExport: PathFinderWorldExport,
      pythonPath?: string
    ) => Promise<{
      success: boolean;
      events?: unknown[];
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      error?: string;
    }>;
  };
  
  file: {
    save: (
      filename: string,
      content: string
    ) => Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
