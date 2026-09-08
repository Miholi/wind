process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'

const { app, BrowserWindow, BrowserView, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell } = require('electron')
const path = require('path')

let mainWindow = null
let tray = null
let isQuitting = false
const registeredShortcut = 'CommandOrControl+Alt+D'
// 窗口在后台停留超过该时长后，唤起时自动重载网页以同步最新会话
const RESYNC_THRESHOLD = 5 * 60 * 1000

let lastHiddenAt = 0

let views = new Map()
let currentView = null
let currentId = null

/* ============ BrowserView 管理 ============ */

function viewBounds() {
  const b = mainWindow.getContentBounds()
  return {
    x: 0,
    y: 0,
    width: b.width,
    height: b.height
  }
}

function sendLoading(val) {
  if (mainWindow) mainWindow.webContents.send('view:loading', val)
}

// 加载结束（成功/失败）后的统一收口
function settleLoad(p, v) {
  v._loaded = true
  if (currentId === p.id) {
    showView(v)
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
    if (currentId === p.id && v._loaded) sendLoading(false)
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
    // 切换到未加载平台时同步移除旧视图，否则旧的 BrowserView 会盖住 loading 过渡页。
    // 同时把 currentView 指向新视图（即使暂时不挂载），加载完成后能正确显示。
    if (currentView && currentView !== v && mainWindow.getBrowserViews().includes(currentView)) {
      mainWindow.removeBrowserView(currentView)
    }
    if (mainWindow.getBrowserViews().includes(v)) mainWindow.removeBrowserView(v)
    currentView = v
    mainWindow.webContents.send('view:loading', true)
  }
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
    backgroundColor: '#0f1322',
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
      hideMainWindow()
    }
  })

  mainWindow.on('minimize', () => {
    if (tray) hideMainWindow()
  })

  mainWindow.on('resize', () => {
    if (currentView) currentView.setBounds(viewBounds())
  })
}

function hideMainWindow() {
  if (!mainWindow) return
  lastHiddenAt = Date.now()
  mainWindow.hide()
}

function showMainWindow() {
  if (!mainWindow) return
  const hiddenAt = lastHiddenAt
  lastHiddenAt = 0
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  // 在后台停留超过阈值时重载当前网页，同步其他客户端产生的新会话
  if (
    hiddenAt > 0 &&
    Date.now() - hiddenAt > RESYNC_THRESHOLD &&
    currentView &&
    currentView._loaded &&
    !currentView.webContents.isLoading() &&
    !currentView.webContents.isDestroyed()
  ) {
    currentView.webContents.reload()
  }
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

ipcMain.on('view:select', (_event, p) => selectPlatform(p))

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
