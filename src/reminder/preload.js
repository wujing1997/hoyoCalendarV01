'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reminderAPI', {
  ready: () => ipcRenderer.send('reminder-ready'),
  acknowledge: (key) => ipcRenderer.invoke('reminder-acknowledge', key),
  subscribe: (callback) => ipcRenderer.on('reminder-state', (_event, state) => callback(state)),
});
