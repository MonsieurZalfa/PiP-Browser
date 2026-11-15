const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pip', {
  command: (name, value) => ipcRenderer.invoke('pip:command', name, value),
  onState: callback => ipcRenderer.on('pip:state', (_event, state) => callback(state)),
});
