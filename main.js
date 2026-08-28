process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'

const { app, BrowserWindow, BrowserView, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

let mainWindow = null
let tray = null
let isQuitting = false
const registeredShortcut = 'CommandOrControl+Alt+D'
const SIDEBAR_W = 204

let views = new Map()
let currentView = null
let currentId = null
// 渲染进程请求暂时隐藏视图时为 true（例如弹出窗口/裁剪头像弹窗打开期间），
// 后台页面加载完成也不得把 BrowserView 盖回弹窗上方。
let uiIntentHidden = false

/* ============ 持久化：头像覆盖 ============ */

function avatarsPath() {
  return path.join(app.getPath('userData'), 'avatars.json')
}

// 归一化图片引用：URL 直接放行；旧数据里的裸盘符路径惰性迁移为 file:// URL；
// 相对路径等其它形式原样放行。
function normalizeImgSrc(img) {
  if (typeof img !== 'string') return ''
  const t = img.trim()
  if (!t) return ''
  // 裁剪导出的头像 data: URL 通常达数十至上百 KB，放宽上限；
  //普通网络/本地引用仍限制长度，防止异常数据撑爆存储
  const maxLen = /^data:/i.test(t) ? 2 * 1024 * 1024 : 4096
  const s = t.slice(0, maxLen)
  if (/^(https?|file|data):/i.test(s)) return s
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\')) {
    try {
      return pathToFileURL(s).href
    } catch {
      return ''
    }
  }
  return s
}

function readAvatars() {
  try {
    const raw = JSON.parse(fs.readFileSync(avatarsPath(), 'utf8'))
    if (raw && typeof raw === 'object') {
      const out = {}
      for (const k of Object.keys(raw)) {
        out[String(k).slice(0, 64)] = normalizeImgSrc(raw[k])
      }
      return out
    }
  } catch {
    /* noop */
  }
  return {}
}

function writeAvatars(map) {
  try {
    const tmp = avatarsPath() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(map || {}, null, 2), 'utf8')
    fs.renameSync(tmp, avatarsPath())
    return true
  } catch (e) {
    console.error('writeAvatars failed:', e)
    return false
  }
}

/* ============ BrowserView 管理 ============ */

function viewBounds() {
  const b = mainWindow.getContentBounds()
  return {
    x: SIDEBAR_W,
    y: 0,
    width: Math.max(1, b.width - SIDEBAR_W),
    height: Math.max(1, b.height)
  }
}

function sendLoading(val) {
  if (mainWindow) mainWindow.webContents.send('view:loading', val)
}

// 加载结束（成功/失败）后的统一收口：尊重弹窗的隐藏意图，避免盖回弹窗上方
function settleLoad(p, v) {
  v._loaded = true
  if (currentId === p.id) {
    if (!uiIntentHidden) showView(v)
    sendLoading(false)
  }
}

function ensureView(p) {
  let v = views.get(p.id)
  if (v) return v
  v = new BrowserView({
    webPreferences: {
      partition: 'persist:web-' + p.id,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
      // sandbox 保持默认（true）：视图没有 preload，无需关闭沙箱
    }
  })
  v._loaded = false
  // 弹出新窗口一律交给系统浏览器；同时完成 scheme 校验，防止 file:// 等被外部打开
  v.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  v.webContents.on('did-start-loading', () => sendLoading(true))
  v.webContents.on('did-stop-loading', () => settleLoad(p, v))
  // 过滤子框架加载失败与 ERR_ABORTED(-3)（重定向/取消），避免 loading 提前消失
  v.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    console.error('[aiweb] 页面加载失败:', p.id, errorCode)
    settleLoad(p, v)
  })
  v.webContents.on('dom-ready', () => {
    if (currentId === p.id && v._loaded && !uiIntentHidden) sendLoading(false)
  })
  // UA 内核版本跟随实际 Chromium 版本，避免与真实浏览器特征不符触发站点风控
  v.webContents.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
  )
  v.webContents.on('render-process-gone', (_event, details) => {
    console.error('[aiweb] 渲染进程退出:', p.id, details && details.reason)
  })
  v.webContents
    .loadURL(p.url)
    .catch((err) => {
      console.error('[aiweb] loadURL failed:', p.id, err && err.message)
      settleLoad(p, v)
    })
  views.set(p.id, v)
  return v
}

function showView(v) {
  if (!mainWindow || !v) return
  if (currentView && currentView !== v) mainWindow.removeBrowserView(currentView)
  if (!mainWindow.getBrowserViews().includes(v)) mainWindow.addBrowserView(v)
  v.setAutoResize({ width: true, height: true, x: false, y: false })
  v.setBounds(viewBounds())
  currentView = v
}

function selectPlatform(p) {
  if (!mainWindow || !p || typeof p !== 'object') return
  const id = typeof p.id === 'string' ? p.id.slice(0, 64) : ''
  const url = typeof p.url === 'string' ? p.url : ''
  if (!id || !/^https?:\/\//i.test(url)) return
  currentId = id
  const v = ensureView({ id: id, url: url })
  if (v._loaded) {
    showView(v)
    mainWindow.webContents.send('view:loading', false)
  } else {
    // 修复：切换到未加载平台时同步移除旧视图，否则旧的 BrowserView 会盖住 loading 遮罩。
    // 同时把 currentView 指向新视图（即使暂时不挂载），保证弹窗关闭后能正确恢复显示。
    if (currentView && currentView !== v && mainWindow.getBrowserViews().includes(currentView)) {
      mainWindow.removeBrowserView(currentView)
    }
    if (mainWindow.getBrowserViews().includes(v)) mainWindow.removeBrowserView(v)
    currentView = v
    mainWindow.webContents.send('view:loading', true)
  }
}

function applyViewVisibility() {
  if (!mainWindow || !currentView) return
  const added = mainWindow.getBrowserViews().includes(currentView)
  if (!uiIntentHidden && !added) mainWindow.addBrowserView(currentView)
  if (uiIntentHidden && added) mainWindow.removeBrowserView(currentView)
}

/* ============ 主窗口 / 托盘 / 菜单 ============ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'AI Web',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
      // sandbox 保持默认（true）：preload 只用 contextBridge + ipcRenderer，兼容沙箱模式
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('minimize', () => {
    if (tray) mainWindow.hide()
  })

  mainWindow.on('resize', () => {
    if (currentView) currentView.setBounds(viewBounds())
  })
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  try {
    // 根据平台选择合适的图标格式
    let iconPath
    if (process.platform === 'win32') {
      iconPath = path.join(__dirname, 'assets', 'icon.ico')
    } else {
      iconPath = path.join(__dirname, 'assets', 'icon.png')
    }
    const icon = nativeImage.createFromPath(iconPath)
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')) : icon)
    tray.setToolTip('AI Web')
    const trayMenu = Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    // 注意：Windows 下若用 setContextMenu 绑定菜单，左键点击会直接弹出菜单、
    // click 事件不再触发。这里改为右键弹菜单、左键唤起窗口。
    tray.on('click', showMainWindow)
    tray.on('right-click', () => {
      if (tray) tray.popUpContextMenu(trayMenu)
    })
  } catch (e) {
    console.error('createTray failed:', e && e.message)
    tray = null
  }
}

// 菜单动作统一转发给当前网页区（BrowserView），而不是外壳 UI。
// 编辑类角色保留默认实现即可按焦点正确分发。
function buildApplicationMenu() {
  const targetWC = () => {
    if (!mainWindow) return null
    if (currentView && mainWindow.getBrowserViews().includes(currentView)) {
      return currentView.webContents
    }
    return mainWindow.webContents
  }

  const quitItem = {
    label: '退出',
    click: () => {
      isQuitting = true
      app.quit()
    }
  }
  const editSubmenu = [
    { role: 'undo', label: '撤销' },
    { role: 'redo', label: '重做' },
    { type: 'separator' },
    { role: 'cut', label: '剪切' },
    { role: 'copy', label: '复制' },
    { role: 'paste', label: '粘贴' },
    { role: 'selectAll', label: '全选' }
  ]
  // 缩放步长对齐 Chromium 的 zoomFactor 范围 [0.25, 5]
  const viewSubmenu = [
    {
      label: '重新加载',
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        const wc = targetWC()
        if (wc) wc.reload()
      }
    },
    {
      label: '后退',
      accelerator: 'Alt+Left',
      click: () => {
        const wc = targetWC()
        if (wc && wc.canGoBack()) wc.goBack()
      }
    },
    {
      label: '前进',
      accelerator: 'Alt+Right',
      click: () => {
        const wc = targetWC()
        if (wc && wc.canGoForward()) wc.goForward()
      }
    },
    {
      label: '开发者工具',
      accelerator: 'CommandOrControl+Alt+I',
      click: () => {
        const wc = targetWC()
        if (wc) wc.toggleDevTools()
      }
    },
    { type: 'separator' },
    {
      label: '实际大小',
      accelerator: 'CmdOrCtrl+0',
      click: () => {
        const wc = targetWC()
        if (wc) wc.setZoomFactor(1)
      }
    },
    {
      label: '放大',
      accelerator: 'CmdOrCtrl+=',
      click: () => {
        const wc = targetWC()
        if (wc) wc.setZoomFactor(Math.min(5, wc.getZoomFactor() + 0.1))
      }
    },
    {
      label: '缩小',
      accelerator: 'CmdOrCtrl+-',
      click: () => {
        const wc = targetWC()
        if (wc) wc.setZoomFactor(Math.max(0.25, wc.getZoomFactor() - 0.1))
      }
    }
  ]
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: '文件', submenu: [quitItem] },
      { label: '编辑', submenu: editSubmenu },
      { label: '视图', submenu: viewSubmenu }
    ])
  )
}

/* ============ IPC ============ */

ipcMain.handle('openExternal', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url)
    return true
  }
  return false
})

ipcMain.on('view:select', (_event, p) => selectPlatform(p))

ipcMain.handle('avatars:get', () => readAvatars())
ipcMain.handle('avatars:set', (_event, id, img) => {
  const map = readAvatars()
  const key = String(id || '').slice(0, 64)
  if (img) map[key] = normalizeImgSrc(img)
  else delete map[key]
  return { ok: writeAvatars(map), map: map }
})

ipcMain.handle('dialog:chooseImage', async () => {
  if (!mainWindow) return null
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return null
    // 返回 data: URL：
    // 1) 规避本地路径中的空格/中文导致的显示问题；
    // 2) file:// 图像绘制到 canvas 会污染画布，导致裁剪结果无法 toDataURL 导出，
    //    data: 引用不污染画布，渲染进程才能做自由裁剪。
    const file = result.filePaths[0]
    const stat = await fs.promises.stat(file)
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024) {
      console.error('[aiweb] chooseImage: 文件不可读或超过 25MB 上限:', file)
      return null
    }
    const buf = await fs.promises.readFile(file)
    const ext = path.extname(file).replace('.', '').toLowerCase()
    const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
    return 'data:' + (MIME[ext] || 'application/octet-stream') + ';base64,' + buf.toString('base64')
  } catch (e) {
    console.error('dialog:chooseImage failed:', e && e.message)
    return null
  }
})

ipcMain.on('view:setVisible', (_event, visible) => {
  uiIntentHidden = !visible
  applyViewVisibility()
})

function setupGlobalShortcut() {
  let ok = false
  try {
    // 先注销可能存在的旧快捷键，避免重复注册
    globalShortcut.unregister(registeredShortcut)
    ok = globalShortcut.register(registeredShortcut, showMainWindow)
  } catch {
    ok = false
  }
  if (!ok) {
    console.warn(`[aiweb] 全局快捷键 ${registeredShortcut} 注册失败（可能被其他程序占用），托盘/再次启动仍可唤起窗口`)
  }
}

/* ============ 应用生命周期 ============ */

app.on('will-quit', () => {
  try {
    // 清理所有BrowserView防止内存泄漏
    if (views.size > 0) {
      views.forEach((view, id) => {
        try {
          if (view && view.webContents && !view.webContents.isDestroyed()) {
            view.webContents.destroy()
          }
        } catch (e) {
          console.error('[aiweb] 清理view失败:', id, e && e.message)
        }
      })
      views.clear()
    }
    globalShortcut.unregisterAll()
  } catch {
    /* noop */
  }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.wind.aiweb')
    buildApplicationMenu()
    createWindow()
    createTray()
    setupGlobalShortcut()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
