const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cutpro', {
  onInit: (handler) => ipcRenderer.on('capture:init', (_, payload) => handler(payload)),
  close: () => ipcRenderer.invoke('capture:close'),
  copyImage: (dataURL) => ipcRenderer.invoke('capture:copy-image', dataURL),
  saveImage: (dataURL) => ipcRenderer.invoke('capture:save-image', dataURL),
  pinImage: (dataURL) => ipcRenderer.invoke('capture:pin-image', dataURL),
  recapture: () => ipcRenderer.invoke('capture:recapture'),
  scrollShot: () => ipcRenderer.invoke('capture:scroll-shot')
});
