const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dsDesktop', {
  selectPlatform: (platform) => ipcRenderer.send('view:select', platform),
  onLoading: (cb) => ipcRenderer.on('view:loading', (_e, val) => cb(val))
})
