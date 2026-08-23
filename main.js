const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, Menu, Tray, nativeImage, globalShortcut, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

let mainWindow = null
let tray = null
let isQuitting = false
const activeAbortControllers = new Map()

function storePath(key) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(key))) {
    throw new Error('invalid data key')
  }
  return path.join(app.getPath('userData'), `${key}.json`)
}

function storeRead(key, fallback) {
  try {
    return JSON.parse(fs.readFileSync(storePath(key), 'utf8'))
  } catch {
    return fallback
  }
}

function storeWrite(key, value) {
  try {
    const file = storePath(key)
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, file + '.bak')
    }
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.error('storeWrite failed:', e)
  }
}

function migrateStores() {
  const s = storeRead('settings', null)
  if (s && typeof s === 'object' && !s._version) {
    s._version = 1
    storeWrite('settings', s)
  }
  const c = storeRead('conversations', null)
  if (Array.isArray(c)) {
    storeWrite('conversations', { _version: 1, items: c, trash: [] })
  } else if (c && typeof c === 'object' && !c._version) {
    c._version = 1
    storeWrite('conversations', c)
  }
}

function encryptSecret(text) {
  if (!text) return null
  if (safeStorage.isEncryptionAvailable()) {
    return Buffer.from(safeStorage.encryptString(text)).toString('base64')
  }
  return null
}

function decryptSecret(enc) {
  if (!enc) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    }
  } catch {
    return ''
  }
  return ''
}

function readSettings() {
  const raw = storeRead('settings', {})
  const settings = { ...raw }
  const encAvail = safeStorage.isEncryptionAvailable()
  if (raw.apiKeyEnc) {
    settings.apiKey = encAvail ? decryptSecret(raw.apiKeyEnc) : ''
    if (!encAvail) settings.apiKeyEnc = raw.apiKeyEnc
  } else {
    settings.apiKey = raw.apiKey || ''
  }
  if (Array.isArray(raw.apiProfiles)) {
    settings.apiProfiles = raw.apiProfiles.map((p) => {
      const prof = { ...p }
      if (prof.apiKeyEnc) {
        prof.apiKey = encAvail ? decryptSecret(prof.apiKeyEnc) : ''
        if (encAvail) delete prof.apiKeyEnc
      } else {
        prof.apiKey = prof.apiKey || ''
      }
      return prof
    })
  }
  return settings
}

function writeSettings(settings) {
  const out = { ...settings }
  const encAvail = safeStorage.isEncryptionAvailable()
  if (encAvail) {
    if (typeof out.apiKey === 'string') {
      out.apiKeyEnc = encryptSecret(out.apiKey) || undefined
      delete out.apiKey
    } else {
      delete out.apiKeyEnc
    }
  } else if (settings.apiKey) {
    delete out.apiKeyEnc
    out.apiKey = settings.apiKey
  } else if (settings.apiKeyEnc) {
    out.apiKeyEnc = settings.apiKeyEnc
    delete out.apiKey
  } else {
    out.apiKey = settings.apiKey
  }
  if (Array.isArray(out.apiProfiles)) {
    out.apiProfiles = out.apiProfiles.map((p) => {
      const prof = { ...p }
      if (encAvail) {
        if (typeof prof.apiKey === 'string') {
          prof.apiKeyEnc = encryptSecret(prof.apiKey) || undefined
          delete prof.apiKey
        } else {
          delete prof.apiKeyEnc
        }
      }
      return prof
    })
  }
  storeWrite('settings', out)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'DeepSeek',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false
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
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.ico'))
  tray = new Tray(icon)
  tray.setToolTip('DeepSeek Desktop')
  const contextMenu = Menu.buildFromTemplate([
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
  tray.setContextMenu(contextMenu)
  tray.on('click', showMainWindow)
}

const menu = Menu.buildFromTemplate([
  {
    label: '文件',
    submenu: [
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ]
  },
  {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ]
  },
  {
    label: '视图',
    submenu: [
      { role: 'reload', label: '重新加载' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' }
    ]
  }
])
Menu.setApplicationMenu(menu)

function normalizeUsage(u) {
  if (!u) return null
  return {
    prompt: u.prompt_tokens ?? u.input_tokens ?? u.prompt ?? 0,
    completion: u.completion_tokens ?? u.output_tokens ?? u.completion ?? 0,
    total: u.total_tokens ?? u.total ?? 0
  }
}

function consumeSSEBlock(buffer) {
  let idx = buffer.indexOf('\n\n')
  const idxCR = buffer.indexOf('\r\n\r\n')
  if (idxCR >= 0 && (idx < 0 || idxCR < idx)) idx = idxCR
  if (idx < 0) return null
  const sepLen = buffer.slice(idx, idx + 4) === '\r\n\r\n' ? 4 : 2
  return { block: buffer.slice(0, idx), rest: buffer.slice(idx + sepLen) }
}

function parseSSE(buffer, emit) {
  let res
  while ((res = consumeSSEBlock(buffer))) {
    buffer = res.rest
    for (const rawLine of res.block.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') {
        emit({ type: 'done' })
        continue
      }
      try {
        const json = JSON.parse(data)
        const delta = json.choices && json.choices[0] && json.choices[0].delta
        if (delta && delta.reasoning_content) {
          emit({ type: 'reasoning', content: delta.reasoning_content })
        }
        if (delta && delta.content) {
          emit({ type: 'content', content: delta.content })
        }
        if (json.usage) {
          emit({ type: 'usage', usage: normalizeUsage(json.usage) })
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
  return buffer
}

function parseSSEResponses(buffer, send) {
  let res
  while ((res = consumeSSEBlock(buffer))) {
    buffer = res.rest
    let eventName = ''
    const datas = []
    for (const rawLine of res.block.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) datas.push(line.slice(5).trim())
    }
    if (!eventName || datas.length === 0) continue
    let json
    try {
      json = JSON.parse(datas.join('\n'))
    } catch {
      continue
    }
    switch (eventName) {
      case 'response.output_text.delta':
        if (json.delta) send({ type: 'content', content: json.delta })
        break
      case 'response.reasoning_text.delta':
        if (json.delta) send({ type: 'reasoning', content: json.delta })
        break
      case 'response.web_search_call.in_progress':
      case 'response.web_search_call.searching':
        send({ type: 'search', status: 'searching' })
        break
      case 'response.web_search_call.completed':
        send({ type: 'search', status: 'done' })
        break
      case 'response.completed':
        if (json.usage) send({ type: 'usage', usage: normalizeUsage(json.usage) })
        send({ type: 'done' })
        break
      case 'response.incomplete':
        send({ type: 'done' })
        break
      case 'response.failed':
        send({ type: 'error', error: (json.error && json.error.message) ? String(json.error.message) : 'Responses API failed' })
        break
    }
  }
  return buffer
}

async function chatViaResponses({ requestId, model, messages, params, apiKey, baseUrl, send, controller }) {
  const instructions =
    ((messages.find((m) => m.role === 'system') || {}).content || '') +
    '\n\n使用联网搜索时：请把搜索到的信息自然地融入回答，保持既定的语气与人设，不要输出 [1]、[2] 之类的引用标记，也不要输出"参考来源"或"信息来源"列表。'
  const input = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content || '' }))
  const thinkingEnabled = !!(params && params.thinking && params.thinking.type === 'enabled')
  const body = {
    model,
    instructions,
    input,
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    reasoning: thinkingEnabled
      ? { effort: (params && (params.effort || params.reasoning_effort)) || 'high' }
      : { effort: 'none' },
    max_output_tokens: params && params.max_tokens,
    temperature: params && params.temperature,
    top_p: params && params.top_p,
    stream: true
  }
  Object.keys(body).forEach((k) => {
    if (body[k] === undefined || body[k] === null) delete body[k]
  })

  const url = `${baseUrl || 'https://api.deepseek.com'}/responses`

  send({ type: 'start' })
  try {
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), 30000)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal ? AbortSignal.any([controller.signal, timeoutCtrl.signal]) : timeoutCtrl.signal
    })
    clearTimeout(timer)

    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 600)
      } catch {
        detail = ''
      }
      send({ type: 'error', error: `HTTP ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}` })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = parseSSEResponses(buffer, (data) => {
        send(data)
        if (data.type === 'done' || data.type === 'error') finished = true
      })
      if (finished) break
    }
    if (!finished) buffer = parseSSEResponses(buffer, send)
    send({ type: 'finish' })
  } catch (err) {
    if (err && err.name === 'AbortError') {
      send({ type: 'aborted' })
    } else {
      send({ type: 'error', error: String((err && err.message) || err) })
    }
  } finally {
    activeAbortControllers.delete(requestId)
  }
}

ipcMain.handle('chat:start', async (event, payload) => {
  const {
    requestId,
    model,
    messages,
    params,
    apiKey,
    baseUrl
  } = payload

  const controller = new AbortController()
  activeAbortControllers.set(requestId, controller)

  let replyContent = ''
  let notified = false
  let failed = false
  const send = (data) => {
    if (data.type === 'content') replyContent += data.content || ''
    if (data.type === 'error' || data.type === 'aborted') failed = true
    if (!event.sender.isDestroyed()) {
      event.sender.send('chat:event', { requestId, ...data })
    }
    if ((data.type === 'done' || data.type === 'finish') && !failed && !notified) {
      notified = true
      try {
        const s = readSettings()
        if (s.notifyOnReply !== false) showReplyNotification(replyContent)
      } catch {
        showReplyNotification(replyContent)
      }
    }
  }

  if (payload.search) {
    await chatViaResponses({ requestId, model, messages, params, apiKey, baseUrl, send, controller })
    return
  }

  const url = `${baseUrl || 'https://api.deepseek.com'}/chat/completions`
  const { thinking, ...restParams } = params || {}
  const body = {
    model,
    messages,
    stream: true,
    ...restParams
  }

  try {
    send({ type: 'start' })
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), 30000)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, timeoutCtrl.signal])
    })
    clearTimeout(timer)

    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 600)
      } catch {
        detail = ''
      }
      send({ type: 'error', error: `HTTP ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}` })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = parseSSE(buffer, send)
    }
    buffer = parseSSE(buffer, send)
    send({ type: 'finish' })
  } catch (err) {
    if (err && err.name === 'AbortError') {
      send({ type: 'aborted' })
    } else {
      send({ type: 'error', error: String((err && err.message) || err) })
    }
  } finally {
    activeAbortControllers.delete(requestId)
  }
})

ipcMain.handle('chat:abort', (_event, requestId) => {
  const controller = activeAbortControllers.get(requestId)
  if (controller) {
    controller.abort()
    return true
  }
  return false
})

ipcMain.handle('settings:get', () => readSettings())

ipcMain.handle('settings:set', (_event, patch) => {
  const current = readSettings()
  const next = { ...current, ...patch }
  writeSettings(next)
  return readSettings()
})

ipcMain.handle('models:list', async (_event, { apiKey, baseUrl } = {}) => {
  try {
    const url = `${(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')}/models`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey || ''}`
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {
        detail = ''
      }
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}` }
    }
    const data = await res.json()
    const models = Array.isArray(data.data)
      ? data.data.map((m) => (m && m.id) || null).filter(Boolean)
      : []
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

ipcMain.handle('title:generate', async (_event, { apiKey, baseUrl, text } = {}) => {
  try {
    const url = `${(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`
    const body = {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            '你是会话标题生成器。根据用户的第一条消息，生成一个简短的中文标题，不超过 20 个字，不要标点符号，不要引号，直接输出标题本身。'
        },
        { role: 'user', content: String(text || '') }
      ],
      max_tokens: 32,
      stream: false
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey || ''}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {
        detail = ''
      }
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}` }
    }
    const data = await res.json()
    const title = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '')
      .trim()
      .replace(/^["'“”\s]+|["'“”\s]+$/g, '')
    return { ok: !!title, title }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

ipcMain.handle('data:get', (_event, key, fallback) => storeRead(key, fallback))

ipcMain.handle('data:set', (_event, key, value) => {
  storeWrite(key, value)
  return true
})

ipcMain.handle('dialog:openPersonas', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const opts = {
    title: '导入人设',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true }
  try {
    const content = fs.readFileSync(res.filePaths[0], 'utf8')
    return { ok: true, filePath: res.filePaths[0], content }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

ipcMain.handle('dialog:savePersonas', async (event, content) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const opts = {
    title: '导出人设',
    defaultPath: 'personas.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  try {
    fs.writeFileSync(res.filePath, content, 'utf8')
    return { ok: true, filePath: res.filePath }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

ipcMain.handle('background:upload', async () => {
  const opts = {
    title: '选择背景图片',
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
    ]
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths.length) {
    return { ok: false }
  }
  const src = result.filePaths[0]
  try {
    const stat = fs.statSync(src)
    if (stat.size > 20 * 1024 * 1024) {
      return { ok: false, error: '图片大小不能超过 20MB' }
    }
    const dir = path.join(app.getPath('userData'), 'backgrounds')
    fs.mkdirSync(dir, { recursive: true })
    const ext = path.extname(src) || '.png'
    const dest = path.join(dir, `${Date.now()}${ext}`)
    fs.copyFileSync(src, dest)
    return { ok: true, path: pathToFileURL(dest).href }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

ipcMain.handle('openExternal', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url)
    return true
  }
  return false
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  userData: app.getPath('userData')
}))

// ---------- 导出 PDF ----------
async function renderHtmlToPdf(html, defaultName, fixedPath) {
  let filePath = fixedPath
  if (!filePath) {
    const opts = {
      title: '导出 PDF',
      defaultPath: (defaultName || 'conversation') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const res = mainWindow ? await dialog.showSaveDialog(mainWindow, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    filePath = res.filePath
  }
  let win = null
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })
    fs.writeFileSync(filePath, pdf)
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  } finally {
    if (win) {
      try {
        win.destroy()
      } catch {
        /* noop */
      }
    }
  }
}

ipcMain.handle('export:pdf', (_event, { html, defaultName, filePath } = {}) => {
  if (typeof html !== 'string' || !html) return { ok: false, error: 'empty html' }
  if (filePath !== undefined && filePath !== null && typeof filePath !== 'string') {
    return { ok: false, error: 'invalid path' }
  }
  return renderHtmlToPdf(html, defaultName, filePath)
})

// ---------- 自动备份 / 快照 ----------
function backupsDir() {
  return path.join(app.getPath('userData'), 'backups')
}

function listBackupFiles() {
  try {
    const dir = backupsDir()
    return fs
      .readdirSync(dir)
      .filter((f) => /^conversations-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(f))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function pruneBackups(keep = 20) {
  const files = listBackupFiles()
  for (const f of files.slice(keep)) {
    try {
      fs.unlinkSync(path.join(backupsDir(), f))
    } catch {
      /* noop */
    }
  }
}

function createBackup() {
  try {
    const s = readSettings()
    if (s.autoBackup === false && !createBackup._manual) return false
    createBackup._manual = false
    const src = storePath('conversations')
    if (!fs.existsSync(src)) return false
    fs.mkdirSync(backupsDir(), { recursive: true })
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    fs.copyFileSync(src, path.join(backupsDir(), `conversations-${stamp}.json`))
    pruneBackups(20)
    return true
  } catch {
    return false
  }
}

let backupTimer = null

function startAutoBackup() {
  createBackup()
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = setInterval(createBackup, 10 * 60 * 1000)
}

app.on('will-quit', () => {
  if (backupTimer) clearInterval(backupTimer)
})

ipcMain.handle('backup:create', () => {
  createBackup._manual = true
  return { ok: createBackup() }
})
ipcMain.handle('backup:list', () =>
  listBackupFiles().map((name) => {
    const m = name.match(/^conversations-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/)
    return {
      name,
      ts: m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0
    }
  })
)

ipcMain.handle('backup:restore', (_event, name) => {
  try {
    if (!/^conversations-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(String(name))) {
      return { ok: false, error: 'invalid backup name' }
    }
    const file = path.join(backupsDir(), name)
    if (!fs.existsSync(file)) return { ok: false, error: 'not found' }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

ipcMain.handle('backup:openFolder', () => {
  fs.mkdirSync(backupsDir(), { recursive: true })
  shell.openPath(backupsDir())
  return true
})

const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+D'
let registeredShortcut = null

function setupGlobalShortcut() {
  unregisterGlobalShortcut()
  const s = readSettings()
  if (s.shortcutEnabled === false) return
  const accel =
    typeof s.shortcutAccelerator === 'string' && s.shortcutAccelerator.trim()
      ? s.shortcutAccelerator.trim()
      : DEFAULT_SHORTCUT
  try {
    const ok = globalShortcut.register(accel, () => {
      showMainWindow()
    })
    if (ok) registeredShortcut = accel
    else console.warn('global shortcut register failed:', accel)
  } catch {
    /* noop */
  }
}

function unregisterGlobalShortcut() {
  if (registeredShortcut) {
    try {
      globalShortcut.unregister(registeredShortcut)
    } catch {
      /* noop */
    }
    registeredShortcut = null
  }
}

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* noop */
  }
})

ipcMain.handle('shortcut:set', (_event, enabled, accelerator) => {
  if (accelerator !== undefined) {
    try {
      const cur = readSettings()
      writeSettings({ ...cur, shortcutAccelerator: String(accelerator || '') })
    } catch {
      /* noop */
    }
  }
  if (enabled) setupGlobalShortcut()
  else unregisterGlobalShortcut()
  return { ok: !!registeredShortcut, accelerator: registeredShortcut }
})

ipcMain.handle('shortcut:isRegistered', () => registeredShortcut)

function showReplyNotification(content) {
  try {
    if (!mainWindow || mainWindow.isFocused()) return
    const body = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const n = new Notification({ title: 'DeepSeek 回复完成', body: body || '回复已完成' })
    n.on('click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
    n.show()
  } catch {
    /* noop */
  }
}

async function readAttachmentFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const name = path.basename(filePath)
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)
  try {
    if (isImage) {
      const buf = fs.readFileSync(filePath)
      return { ok: true, type: 'image', name, ext, dataUrl: 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + buf.toString('base64') }
    }
    const content = fs.readFileSync(filePath, 'utf8').slice(0, 20000)
    return { ok: true, type: 'text', name, ext, content }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
}

const ATTACHMENT_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
const ATTACHMENT_TEXT_EXTS = ['txt', 'md', 'json', 'js', 'ts', 'py', 'html', 'css', 'csv', 'log', 'xml']

ipcMain.handle('dialog:openAttachmentPath', (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'invalid path' }
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const allowed = ATTACHMENT_IMAGE_EXTS.concat(ATTACHMENT_TEXT_EXTS)
  if (!allowed.includes(ext)) return { ok: false, error: 'unsupported file type' }
  let real = null
  try {
    real = fs.realpathSync(filePath)
  } catch {
    return { ok: false, error: 'file not found' }
  }
  return readAttachmentFile(real)
})

ipcMain.handle('dialog:openAttachment', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const opts = {
    title: '选择附件',
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: '文本', extensions: ['txt', 'md', 'json', 'js', 'ts', 'py', 'html', 'css', 'csv', 'log', 'xml'] }
    ],
    properties: ['openFile']
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true }
  return readAttachmentFile(res.filePaths[0])
})

ipcMain.handle('dialog:saveConversation', async (event, { contents, content, defaultName } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const opts = {
    title: '导出对话',
    defaultPath: (defaultName || 'conversation') + '.md',
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'PDF', extensions: ['pdf'] }
    ]
  }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  const ext = path.extname(res.filePath).toLowerCase().replace('.', '')
  if (ext === 'pdf') {
    return { ok: false, needPdf: true, filePath: res.filePath }
  }
  try {
    const payload = contents && typeof contents === 'object' ? contents[ext] : content
    fs.writeFileSync(res.filePath, payload == null ? '' : String(payload), 'utf8')
    return { ok: true, filePath: res.filePath }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
})

ipcMain.handle('dialog:openConversation', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const opts = {
    title: '导入对话',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true }
  try {
    const content = fs.readFileSync(res.filePaths[0], 'utf8')
    return { ok: true, content }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
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
    app.setAppUserModelId('com.wind.deepseek-desktop')
    migrateStores()
    createWindow()
    createTray()
    setupGlobalShortcut()
    startAutoBackup()

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