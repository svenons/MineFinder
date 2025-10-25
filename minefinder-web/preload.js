import { contextBridge } from 'electron';

// Expose limited API to renderer process
contextBridge.exposeInMainWorld('electron', {
  app: {
    getName: () => 'MineFinder',
  },
});
