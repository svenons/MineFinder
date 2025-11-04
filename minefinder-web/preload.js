import { contextBridge, ipcRenderer } from 'electron';

// Expose limited API to renderer process
contextBridge.exposeInMainWorld('electron', {
  app: {
    getName: () => 'MineFinder',
    getPaths: () => ipcRenderer.invoke('app:getPaths'),
  },
  
  pathFinder: {
    /**
     * Run PathFinder simulation with world export
     * @param worldExport - PathFinderWorldExport data
     * @param pythonPath - Optional Python executable path
     */
    run: (worldExport, pythonPath) => 
      ipcRenderer.invoke('pathfinder:run', { worldExport, pythonPath }),
  },
  
  file: {
    /**
     * Save data to file in user data directory
     * @param filename - Name of file to save
     * @param content - String content to write
     */
    save: (filename, content) => 
      ipcRenderer.invoke('file:save', { filename, content }),
  },
});
