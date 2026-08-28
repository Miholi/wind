const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dsDesktop', {
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  selectPlatform: (platform) => ipcRenderer.send('view:select', platform),
  onLoading: (cb) => ipcRenderer.on('view:loading', (_e, val) => cb(val)),
  getAvatars: () => ipcRenderer.invoke('avatars:get'),
  setAvatar: (id, img) => ipcRenderer.invoke('avatars:set', id, img),
  chooseImage: () => ipcRenderer.invoke('dialog:chooseImage'),
  setViewVisible: (visible) => ipcRenderer.send('view:setVisible', visible)
})
