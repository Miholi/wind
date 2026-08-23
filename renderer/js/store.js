(function () {
  const DEFAULT_SETTINGS = {
    _version: 1,
    theme: 'system',
    accent: '#4d6bfe',
    codeTheme: 'auto',
    fontSize: 'medium',
    lineHeight: 'normal',
    messageWidth: 'standard',
    bubbleStyle: 'filled',
    inputRows: 3,
    sidebarWidth: 264,
    typingAnim: true,
    markdown: true,
    autoTitle: true,
    notifyOnReply: true,
    shortcutEnabled: true,
    shortcutAccelerator: 'CommandOrControl+Alt+D',
    autoBackup: true,
    apiProfiles: [],
    activeProfileId: '',
    language: 'zh-CN',
    background: {
      type: 'none',
      value: null,
      fit: 'cover',
      opacity: 40,
      dimDark: true
    },
    baseUrl: 'https://api.deepseek.com',
    personas: []
  }

  let settings = null
  let conversations = null
  let trash = []
  let loadPromise = null

  function mergeSettings(s) {
    const out = Object.assign({}, DEFAULT_SETTINGS, s || {})
    out.background = Object.assign({}, DEFAULT_SETTINGS.background, (s && s.background) || {})
    if (!Array.isArray(out.apiProfiles)) out.apiProfiles = []
    return out
  }

  function activeApiCreds() {
    const s = getSettingsSafe()
    const prof = (s.apiProfiles || []).find((p) => p.id === s.activeProfileId)
    if (prof) return { apiKey: prof.apiKey || '', baseUrl: prof.baseUrl || 'https://api.deepseek.com' }
    return { apiKey: s.apiKey || '', baseUrl: s.baseUrl || 'https://api.deepseek.com' }
  }

  function getSettingsSafe() {
    return settings || DEFAULT_SETTINGS
  }

  function migrateApiProfiles() {
    if (!settings) return
    if (!Array.isArray(settings.apiProfiles)) settings.apiProfiles = []
    if (settings.apiKey && settings.apiProfiles.length === 0) {
      settings.apiProfiles.push({
        id: 'default',
        name: '默认档案',
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || 'https://api.deepseek.com'
      })
      settings.activeProfileId = 'default'
    }
    if (settings.apiProfiles.length && !settings.activeProfileId) {
      settings.activeProfileId = settings.apiProfiles[0].id
    }
  }

  const Store = {
    async init() {
      if (loadPromise) return loadPromise
      loadPromise = (async () => {
        const [st, raw] = await Promise.all([
          window.dsDesktop.getSettings(),
          window.dsDesktop.getData('conversations', null)
        ])
        settings = mergeSettings(st)
        migrateApiProfiles()
        if (Array.isArray(raw)) {
          conversations = raw
          trash = []
        } else if (raw && typeof raw === 'object') {
          conversations = Array.isArray(raw.items) ? raw.items : []
          trash = Array.isArray(raw.trash) ? raw.trash : []
        } else {
          conversations = []
          trash = []
        }
        this.applyLanguage(settings.language)
        return true
      })()
      return loadPromise
    },

    getSettings() {
      return settings
    },

    activeApiCreds() {
      return activeApiCreds()
    },

    async persistSettings() {
      const next = settings
      const apiKey = next.apiKey
      const plain = Object.assign({}, next)
      delete plain.apiKey
      await window.dsDesktop.setSettings({ ...plain, apiKey })
    },

    async saveSettings(patch) {
      const base = Object.assign({}, settings, patch || {})
      if (patch && patch.background) {
        base.background = Object.assign({}, settings.background, patch.background)
      }
      settings = mergeSettings(base)
      await this.persistSettings()
      return settings
    },

    async resetSettings(preserve) {
      const s = settings
      const keep = Object.assign({}, preserve || {})
      if (keep.personas === undefined) keep.personas = s.personas || []
      if (keep.baseUrl === undefined) keep.baseUrl = s.baseUrl || 'https://api.deepseek.com'
      if (keep.apiProfiles === undefined) keep.apiProfiles = s.apiProfiles || []
      if (keep.activeProfileId === undefined) keep.activeProfileId = s.activeProfileId || ''
      settings = mergeSettings(keep)
      await this.persistSettings()
      return settings
    },

    async updateBackground(patch) {
      const bg = Object.assign({}, settings.background, patch)
      await this.saveSettings({ background: bg })
      return bg
    },

    applyLanguage(lang) {
      window.I18N.setLang(lang)
      window.I18N.applyI18n()
      document.getElementById('set-language').value = lang
    },

    getConversations() {
      return conversations
    },

    getConversation(id) {
      return conversations.find((c) => c.id === id) || null
    },

    async createConversation(model, overrides) {
      const c = {
        id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: window.I18N.t('first_msg_default'),
        model: model || 'deepseek-v4-flash',
        thinking: true,
        search: false,
        systemPrompt: '',
        draft: '',
        params: { temperature: 1, top_p: 1, max_tokens: 8192, effort: 'medium' },
        messages: [],
        pinned: false,
        folder: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      Object.assign(c, overrides || {})
      conversations.unshift(c)
      await this.saveConversations()
      return c
    },

    async updateConversation(id, patch) {
      const c = this.getConversation(id)
      if (!c) return null
      Object.assign(c, patch, { updatedAt: Date.now() })
      await this.saveConversations()
      return c
    },

    async removeConversation(id) {
      const c = this.getConversation(id)
      if (c) {
        trash.unshift(Object.assign({}, c, { deletedAt: Date.now() }))
        conversations = conversations.filter((x) => x.id !== id)
      }
      await this.saveConversations()
    },

    getTrash() {
      return trash
    },

    async restoreConversation(id) {
      const idx = trash.findIndex((c) => c.id === id)
      if (idx >= 0) {
        const c = trash.splice(idx, 1)[0]
        delete c.deletedAt
        conversations.unshift(c)
        await this.saveConversations()
      }
    },

    async purgeConversation(id) {
      trash = trash.filter((c) => c.id !== id)
      await this.saveConversations()
    },

    async emptyTrash() {
      trash = []
      await this.saveConversations()
    },

    async restoreSnapshotData(data) {
      if (Array.isArray(data)) {
        conversations = data
        trash = []
      } else if (data && typeof data === 'object') {
        conversations = Array.isArray(data.items) ? data.items : []
        trash = Array.isArray(data.trash) ? data.trash : []
      } else {
        return false
      }
      await this.saveConversations()
      return true
    },

    async saveConversations() {
      await window.dsDesktop.setData('conversations', {
        _version: 1,
        items: conversations,
        trash
      })
    },

    async togglePin(id) {
      const c = this.getConversation(id)
      if (!c) return null
      c.pinned = !c.pinned
      await this.saveConversations()
      return c
    },

    async setFolder(id, folder) {
      const c = this.getConversation(id)
      if (!c) return null
      c.folder = String(folder || '').trim()
      await this.saveConversations()
      return c
    },

    getFolders() {
      const set = new Set()
      conversations.forEach((c) => {
        if (c.folder) set.add(c.folder)
      })
      return Array.from(set)
    },

    computeUsageStats() {
      const now = Date.now()
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const dayStart = today.getTime()
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000
      const stats = { today: { prompt: 0, completion: 0, total: 0, count: 0 }, week: { prompt: 0, completion: 0, total: 0, count: 0 }, all: { prompt: 0, completion: 0, total: 0, count: 0 }, byModel: {} }
      const addUsage = (bucket, usage) => {
        bucket.prompt += usage.prompt || 0
        bucket.completion += usage.completion || 0
        bucket.total += usage.total || (usage.prompt || 0) + (usage.completion || 0)
        bucket.count += 1
      }
      conversations.forEach((c) => {
        ;(c.messages || []).forEach((m) => {
          if (m.role !== 'assistant' || !m.usage) return
          const usage = { prompt: m.usage.prompt || 0, completion: m.usage.completion || 0, total: m.usage.total || 0 }
          if (!usage.total && (usage.prompt || usage.completion)) usage.total = usage.prompt + usage.completion
          addUsage(stats.all, usage)
          if (m.ts >= weekAgo) addUsage(stats.week, usage)
          if (m.ts >= dayStart) addUsage(stats.today, usage)
          const key = m.model || c.model || 'unknown'
          if (!stats.byModel[key]) stats.byModel[key] = { prompt: 0, completion: 0, total: 0, count: 0 }
          addUsage(stats.byModel[key], usage)
        })
      })
      return stats
    }
  }

  window.Store = Store
})()