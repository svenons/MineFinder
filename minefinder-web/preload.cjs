const { contextBridge, ipcRenderer } = require('electron');

// Expose limited API to renderer process (CommonJS preload)
contextBridge.exposeInMainWorld('electron', {
  app: {
    getName: () => 'MineFinder',
    getPaths: () => ipcRenderer.invoke('app:getPaths'),
  },

  pathFinder: {
    /**
     * Run PathFinder simulation with world export
     * @param {any} worldExport - PathFinderWorldExport data
     * @param {string} [pythonPath] - Optional Python executable path
     */
    run: (worldExport, pythonPath) => ipcRenderer.invoke('pathfinder:run', { worldExport, pythonPath }),
  },

  file: {
    /**
     * Save data to file in user data directory
     * @param {string} filename - Name of file to save
     * @param {string} content - String content to write
     */
    save: (filename, content) => ipcRenderer.invoke('file:save', { filename, content }),
  },

  // Serial bridge (Pi connection)
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:listPorts'),
    open: (port, baud) => ipcRenderer.invoke('serial:open', { port, baud }),
    close: () => ipcRenderer.invoke('serial:close'),
    writeLine: (data) => ipcRenderer.invoke('serial:writeLine', { data }),
    onLine: (handler) => {
      const listener = (_event, line) => handler(line);
      ipcRenderer.on('serial:line', listener);
      return () => ipcRenderer.removeListener('serial:line', listener);
    },
    onStatus: (handler) => {
      const listener = (_event, status) => handler(status);
      ipcRenderer.on('serial:status', listener);
      return () => ipcRenderer.removeListener('serial:status', listener);
    },
  },
});
