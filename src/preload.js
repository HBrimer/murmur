'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Explicit, minimal bridge. The renderer can only call what's listed here.
contextBridge.exposeInMainWorld('murmur', {
  // engine / setup
  probeEngine: () => ipcRenderer.invoke('engine:probe'),
  catalog: () => ipcRenderer.invoke('engine:catalog'),
  downloadModel: (key) => ipcRenderer.invoke('engine:download', key),
  openBinDir: () => ipcRenderer.invoke('engine:openBinDir'),
  openModelsDir: () => ipcRenderer.invoke('engine:openModelsDir'),
  onDownloadProgress: (cb) => {
    const h = (_e, p) => cb(p); ipcRenderer.on('engine:download-progress', h);
    return () => ipcRenderer.removeListener('engine:download-progress', h);
  },

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // license
  getLicense: () => ipcRenderer.invoke('license:get'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),
  deactivateLicense: () => ipcRenderer.invoke('license:deactivate'),

  // library
  listLibrary: () => ipcRenderer.invoke('library:list'),
  getRecord: (id) => ipcRenderer.invoke('library:get', id),
  deleteRecord: (id) => ipcRenderer.invoke('library:delete', id),

  // input
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  pickFolder: () => ipcRenderer.invoke('audio:pickFolder'),
  // Electron 32+ removed File.path; resolve dropped files' paths here.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  saveRecording: (bytes, ext) => ipcRenderer.invoke('audio:saveRecording', { bytes, ext }),

  // job
  runJob: (filePath, title) => ipcRenderer.invoke('job:run', { filePath, title }),
  cancelJob: () => ipcRenderer.invoke('job:cancel'),
  onProgress: (cb) => {
    const h = (_e, p) => cb(p); ipcRenderer.on('job:progress', h);
    return () => ipcRenderer.removeListener('job:progress', h);
  },

  // misc
  exportRecord: (id, format) => ipcRenderer.invoke('export:save', { id, format }),
  revealStore: () => ipcRenderer.invoke('store:reveal')
});
