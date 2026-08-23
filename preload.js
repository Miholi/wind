const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('dsDesktop', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  listModels: (opts) => ipcRenderer.invoke('models:list', opts),
  getData: (key, fallback) => ipcRenderer.invoke('data:get', key, fallback),
  setData: (key, value) => ipcRenderer.invoke('data:set', key, value),
  chatStart: (payload) => ipcRenderer.invoke('chat:start', payload),
  chatAbort: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
  generateTitle: (opts) => ipcRenderer.invoke('title:generate', opts),
  onChatEvent: (cb) => {
    ipcRenderer.on('chat:event', (_event, data) => cb(data))
  },
  uploadBackground: () => ipcRenderer.invoke('background:upload'),
  openPersonas: () => ipcRenderer.invoke('dialog:openPersonas'),
  savePersonas: (content) => ipcRenderer.invoke('dialog:savePersonas', content),
  openAttachment: () => ipcRenderer.invoke('dialog:openAttachment'),
  openAttachmentPath: (filePath) => ipcRenderer.invoke('dialog:openAttachmentPath', filePath),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  saveConversation: (opts) => ipcRenderer.invoke('dialog:saveConversation', opts),
  exportPdf: (opts) => ipcRenderer.invoke('export:pdf', opts),
  openConversation: () => ipcRenderer.invoke('dialog:openConversation'),
  setShortcut: (enabled, accelerator) => ipcRenderer.invoke('shortcut:set', enabled, accelerator),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  appInfo: () => ipcRenderer.invoke('app:info'),
  backupCreate: () => ipcRenderer.invoke('backup:create'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRestore: (name) => ipcRenderer.invoke('backup:restore', name),
  backupOpenFolder: () => ipcRenderer.invoke('backup:openFolder')
})
