/* ServicePulse — preload. Exposes a minimal, read-only system API to the renderer. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  overview: () => ipcRenderer.invoke('sys:overview'),
  processes: () => ipcRenderer.invoke('sys:processes'),
  platform: process.platform
});
