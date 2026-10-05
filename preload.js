'use strict';

// The only bridge between the web pages and the main process.
// Pages get these few functions and nothing else (no Node, no raw ipcRenderer).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // companion (the buddy in the corner)
  onShow: (callback) => {
    ipcRenderer.removeAllListeners('companion:show');
    ipcRenderer.on('companion:show', (_event, payload) => callback(payload));
  },
  answer: (action) => ipcRenderer.invoke('companion:answer', action),
  done: () => ipcRenderer.send('companion:done'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('companion:ignore-mouse', Boolean(ignore)),

  // setup window
  getSetupData: () => ipcRenderer.invoke('setup:get'),
  saveSetup: (data) => ipcRenderer.invoke('setup:save', data),
  cancelSetup: () => ipcRenderer.send('setup:cancel'),
  openCharactersFolder: () => ipcRenderer.invoke('setup:open-characters-folder'),

  // settings and stats window
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  savePrefs: (data) => ipcRenderer.invoke('prefs:save', data),
  closePrefs: () => ipcRenderer.send('prefs:close'),
  onGoto: (callback) => ipcRenderer.on('prefs:goto', (_event, section) => callback(section)),
  pickImage: (pose) => ipcRenderer.invoke('character:pick-image', pose),
  createCharacter: (data) => ipcRenderer.invoke('character:create', data),
  deleteCharacter: (id) => ipcRenderer.invoke('character:delete', id),
  useCharacter: (id) => ipcRenderer.invoke('character:use', id),
});
