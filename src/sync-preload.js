const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pipSync', {
  command: (name, value) => ipcRenderer.invoke('pip:sync-command', name, value),
  onState: callback => ipcRenderer.on('pip:sync-state', (_event, state) => callback(state)),
});
