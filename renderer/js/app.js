(function () {
  const $ = (sel) => document.querySelector(sel)
  const t = (k) => window.I18N.t(k)

  const MODEL_LABELS = {
    'deepseek-v4-flash': 'DeepSeek-V4-Flash',
    'deepseek-v4-pro': 'DeepSeek-V4-Pro'
  }

  const PROMPT_PRESETS = [
    {
      id: 'clear',
      labelKey: 'prompt_clear',
      prompt: ''
    },
    {
      id: 'warm_lover',
      labelKey: 'preset_warm_lover',
      prompt: '你现在是我温柔的恋人，请用温暖、体贴、充满爱意的语气和我说话，主动关心我的情绪和感受，多倾听、多共情，语气自然亲密，不要用格式化的列表或生硬的回答，像一个真实的人在温柔地陪伴我。'
    },
    {
      id: 'best_friend',
      labelKey: 'preset_best_friend',
      prompt: '你是我的知心好友，请用亲切、真诚、轻松的语气聊天，像多年好友一样自然，主动关心我最近的情况，分享你的感受，给我建议时温柔委婉，让我感到被理解和陪伴。'
    },
    {
      id: 'mind_mentor',
      labelKey: 'preset_mind_mentor',
      prompt: '你是我的心灵导师，请以平和、理性、充满关怀的语气引导我梳理情绪，帮助我认识自己的内心，给出温暖而有深度的建议，不评判、不说教，始终站在支持我的立场。'
    },
    {
      id: 'vibrant_companion',
      labelKey: 'preset_vibrant_companion',
      prompt: '你是元气满满的伙伴，请用活泼、阳光、充满能量的语气和我交流，多给我打气鼓劲，语气轻快有趣，让我感到愉快、轻松和被支持。'
    }
  ]

  let lastModel = 'deepseek-v4-flash'
  let availableModels = []
  let activeStreams = 0

  const { state } = window.UI

  function debounce(fn, ms) {
    let timer = null
    return (...args) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), ms)
    }
  }

  // ---------- 初始化 ----------
  async function init() {
    await window.Store.init()
    const settings = window.Store.getSettings()
    window.UI.applyAll(settings)
    window.UI.renderChatList()
    renderActive()
    bindEvents()
    setupSystemThemeListener()
    window.UI.resizeInput()
    setSendingState(false)
    loadModels()
    renderPromptPresets()
    $('#chat-input').focus()
    window.addEventListener('focus', () => {
      const el = document.activeElement
      if (!el || el === document.body || el === document.documentElement) {
        $('#chat-input').focus()
      }
    })
  }

  function renderActive() {
    const conv = window.Store.getConversation(state.activeId)
    window.UI.renderMessages()
    if (conv) syncHeader(conv)
    const ta = $('#chat-input')
    if (state.activeId && conv) {
      if (document.activeElement !== ta) ta.value = conv.draft || ''
    } else if (!conv) {
      ta.value = ''
    }
    window.UI.resizeInput()
  }

  function setupSystemThemeListener() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const s = window.Store.getSettings()
      if (s.theme === 'system') window.UI.applyTheme(s)
    })
  }

  // ---------- 会话 ----------
  async function ensureActiveConversation() {
    let conv = window.Store.getConversation(state.activeId)
    if (!conv) {
      resetTrashMode()
      conv = await window.Store.createConversation(lastModel, {
        thinking: $('#thinking-toggle').checked,
        search: $('#search-toggle').checked
      })
      state.activeId = conv.id
      window.UI.renderChatList()
      syncHeader(conv)
    }
    return conv
  }

  function syncHeader(conv) {
    $('#model-label').textContent = MODEL_LABELS[conv.model] || conv.model
    $('#thinking-toggle').checked = !!conv.thinking
    $('#search-toggle').checked = !!conv.search
    const p = conv.params || {}
    $('#param-temp').value = p.temperature ?? 1
    $('#param-temp-val').textContent = Number(p.temperature ?? 1).toFixed(1)
    $('#param-top-p').value = p.top_p ?? 1
    $('#param-top-p-val').textContent = Number(p.top_p ?? 1).toFixed(2)
    $('#param-max-tokens').value = p.max_tokens ?? 8192
    $('#param-effort').value = p.effort || 'medium'
    const cmpToggle = $('#compare-toggle')
    const cmpSelect = $('#compare-model-select')
    if (cmpToggle && cmpSelect) {
      cmpToggle.checked = !!conv.compareEnabled
      cmpSelect.disabled = !conv.compareEnabled
      cmpSelect.value = conv.compareModel || ''
    }
    populateCompareModels()
  }

  function populateCompareModels() {
    const sel = $('#compare-model-select')
    if (!sel) return
    const conv = window.Store.getConversation(state.activeId)
    const models = availableModels.slice()
    if (conv && conv.compareModel && !models.includes(conv.compareModel)) models.push(conv.compareModel)
    const current = sel.value || (conv ? conv.compareModel : '') || ''
    sel.innerHTML =
      `<option value="" disabled${models.length ? '' : ' selected'}>${window.UI.esc(t('compare_pick_model'))}</option>` +
      models.map((m) => `<option value="${window.UI.esc(m)}"${m === current ? ' selected' : ''}>${window.UI.esc(MODEL_LABELS[m] || m)}</option>`).join('')
  }

  function buildApiParams(conv) {
    const p = conv.params || {}
    const body = {
      temperature: p.temperature ?? 1,
      top_p: p.top_p ?? 1,
      max_tokens: p.max_tokens ?? 8192
    }
    if (conv.thinking) {
      body.thinking = { type: 'enabled' }
      if (p.effort) body.reasoning_effort = p.effort
    } else {
      body.thinking = { type: 'disabled' }
    }
    return body
  }

  // ---------- 发送 / 流式 ----------
  function setSendingState(on) {
    const btn = $('#send-btn')
    btn.classList.toggle('stop', on)
    btn.classList.toggle('disabled', on)
    btn.title = on ? t('stop') : t('send')
    btn.innerHTML = on
      ? `<svg viewBox="0 0 24 24" class="icon"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>`
      : `<svg viewBox="0 0 24 24" class="icon"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    updateInputTip(on)
    $('#chat-input').readOnly = on
  }

  function updateInputTip(sending) {
    const tip = $('#input-tip')
    if (!tip) return
    if (sending) {
      tip.textContent = t('thinking')
      tip.classList.add('sending')
      tip.hidden = false
    } else {
      tip.textContent = t('unsaved_tip')
      tip.classList.remove('sending')
      tip.hidden = $('#chat-input').value.trim() !== ''
    }
  }

  function flushAnimation(ctx) {
    if (!ctx.queue) {
      ctx.raf = null
      return
    }
    if (ctx.target) ctx.target.textContent += ctx.queue
    ctx.queue = ''
    window.UI.scrollToBottom()
    ctx.raf = requestAnimationFrame(() => flushAnimation(ctx))
  }

  async function sendMessage() {
    if (state.streaming) return
    const ta = $('#chat-input')
    const text = ta.value.trim()
    if (!text) return

    const conv = await ensureActiveConversation()
    const creds = window.Store.activeApiCreds()
    if (!creds.apiKey) {
      window.UI.toast(t('err_no_key'))
      window.openSettings()
      return
    }

    conv.messages.push({ role: 'user', content: text, ts: Date.now() })
    if (!conv.title || conv.title === t('first_msg_default')) {
      conv.title = text.slice(0, 30)
    }
    conv.draft = ''
    ta.value = ''
    window.UI.resizeInput()
    await window.Store.saveConversations()
    window.UI.renderMessages()
    window.UI.renderChatList()

    const first = await streamAnswer(conv)
    const compareOk =
      first && first.ok && conv.compareEnabled && conv.compareModel && conv.compareModel !== conv.model
    if (compareOk) {
      await streamAnswer(conv, { model: conv.compareModel })
    }
  }

  async function streamAnswer(conv, opts = {}) {
    const targetModel = opts.model || conv.model
    const settings = window.Store.getSettings()
    const assistantMsg = opts.msg || { role: 'assistant', content: '', reasoning: '', searched: false, ts: Date.now() }
    if (opts.model) assistantMsg.model = targetModel
    if (!opts.msg) conv.messages.push(assistantMsg)

    const ctx = { searchNote: null, node: null, queue: '', raf: null, target: null }

    const makeSearchBadge = (status) => {
      if (!ctx.node) return
      const text = '🔍 ' + (status === 'searching' ? t('searching') : t('searched'))
      let el = ctx.searchNote || ctx.node.querySelector('.search-badge')
      if (el) {
        el.textContent = text
        el.classList.toggle('searching', status === 'searching')
        ctx.searchNote = el
        return
      }
      el = document.createElement('span')
      el.className = 'search-badge' + (status === 'searching' ? ' searching' : '')
      el.textContent = text
      const label = ctx.node.querySelector('.msg-label')
      ctx.node.insertBefore(el, label ? label.nextSibling : ctx.node.firstChild)
      ctx.searchNote = el
    }

    activeStreams += 1
    window.UI.state.streaming = true
    window.UI.state.streamingReasoningActive = false
    setSendingState(true)

    const area = $('#messages')
    ctx.node = window.UI.renderMessage(assistantMsg, true)
    area.appendChild(ctx.node)
    ctx.target = ctx.node.querySelector('.msg-content')
    let reasoningEl = ctx.node.querySelector('.reasoning-body')
    window.UI.scrollToBottom(true)

    const finalize = (aborted) => {
      activeStreams -= 1
      if (activeStreams <= 0) {
        activeStreams = 0
        window.UI.state.streaming = false
        window.UI.state.streamingReasoningActive = false
        setSendingState(false)
      }
      ctx.searchNote = null

      if (ctx.raf) {
        cancelAnimationFrame(ctx.raf)
        ctx.raf = null
        ctx.queue = ''
      }
      ctx.target = null

      const hasNewContent = !!(assistantMsg.content || assistantMsg.reasoning)

      if (aborted && !hasNewContent) {
        const variants = Array.isArray(assistantMsg.variants) ? assistantMsg.variants : []
        if (variants.length) {
          applyVariant(assistantMsg, variants[variants.length - 1])
          assistantMsg.vindex = variants.length - 1
        } else {
          const idx = conv.messages.indexOf(assistantMsg)
          if (idx >= 0) conv.messages.splice(idx, 1)
          if (ctx.node) ctx.node.remove()
          ctx.node = null
          window.Store.saveConversations()
          window.UI.renderChatList()
          window.UI.scrollToBottom(true)
          return
        }
      } else if (hasNewContent || assistantMsg.error) {
        if (!Array.isArray(assistantMsg.variants)) assistantMsg.variants = []
        assistantMsg.variants.push(snapshotVariant(assistantMsg))
        assistantMsg.vindex = assistantMsg.variants.length - 1
      }

      if (ctx.node) {
        const newNode = window.UI.renderMessage(assistantMsg, false)
        ctx.node.replaceWith(newNode)
        ctx.node = null
      }
      window.Store.saveConversations()
      window.UI.renderChatList()
      window.UI.scrollToBottom()
      maybeAutoTitle(conv)
    }

    const displayModel = MODEL_LABELS[targetModel] || targetModel
    const basePrompt = `You are ${displayModel}, a helpful assistant. 请始终使用中文进行深度思考（chain-of-thought），回答时使用与用户提问一致的语言。`
    const customPrompt = (conv.systemPrompt || '').trim()
    const systemContent = customPrompt ? `${customPrompt}\n\n${basePrompt}` : basePrompt
    const apiMessages = [
      { role: 'system', content: systemContent },
      ...conv.messages
        .filter((m) => m.content && m.role !== 'system' && m !== assistantMsg)
        .map((m) => ({ role: m.role, content: m.content }))
    ]

    const result = await window.Api.start({
      model: targetModel,
      messages: apiMessages,
      params: buildApiParams(conv),
      search: !!conv.search,
      onContent: (delta) => {
        if (ctx.searchNote && ctx.searchNote.classList.contains('searching')) {
          assistantMsg.searched = true
          makeSearchBadge('done')
        }
        assistantMsg.content += delta
        if (settings.typingAnim) {
          ctx.queue += delta
          if (!ctx.raf) ctx.raf = requestAnimationFrame(() => flushAnimation(ctx))
        } else {
          if (ctx.target) ctx.target.textContent = assistantMsg.content
          window.UI.scrollToBottom()
        }
      },
      onReasoning: (delta) => {
        if (!window.UI.state.streamingReasoningActive) {
          window.UI.state.streamingReasoningActive = true
          assistantMsg.reasoning = delta
          ctx.searchNote = null
          const newNode = window.UI.renderMessage(assistantMsg, true)
          ctx.node.replaceWith(newNode)
          ctx.node = newNode
          reasoningEl = ctx.node.querySelector('.reasoning-body')
          ctx.target = ctx.node.querySelector('.msg-content')
          if (ctx.target) ctx.target.textContent = assistantMsg.content
          if (assistantMsg.searched) makeSearchBadge('done')
          window.UI.scrollToBottom(true)
          return
        }
        assistantMsg.reasoning += delta
        if (reasoningEl) {
          reasoningEl.textContent = assistantMsg.reasoning
          reasoningEl.scrollTop = reasoningEl.scrollHeight
        }
      },
      onSearch: (status) => {
        assistantMsg.searched = true
        makeSearchBadge(status)
      },
      onUsage: (usage) => {
        assistantMsg.usage = usage
      },
      onAbort: () => {
        finalize(true)
      },
      onError: (rawError) => {
        const msg =
          rawError === 'err_no_key'
            ? t('err_no_key')
            : /network|fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|timeout|timed?\s?out/i.test(rawError || '')
            ? t('err_network')
            : rawError
        assistantMsg.error = msg
        finalize(false)
      }
    })

    let ok = false
    if (result && result.ok && !result.error) {
      finalize(false)
      ok = true
    }
    return { ok }
  }

  async function switchConversation(id) {
    if (state.streaming) {
      window.Api.abort()
    }
    resetTrashMode()
    state.activeId = id
    window.UI.renderChatList()
    renderActive()
    focusInput()
  }

  // ---------- 设置 ----------
  async function updateSettings(patch) {
    const s = await window.Store.saveSettings(patch)
    window.UI.applyAll(s)
    window.UI.syncSettingsPanel(s)
    window.Store.applyLanguage(s.language)
    if (
      patch &&
      (patch.apiKey !== undefined ||
        patch.baseUrl !== undefined ||
        patch.apiProfiles !== undefined ||
        patch.activeProfileId !== undefined)
    )
      loadModels()
    return s
  }

  async function loadModels() {
    const creds = window.Store.activeApiCreds()
    if (!creds.apiKey) return
    const res = await window.dsDesktop.listModels({ apiKey: creds.apiKey, baseUrl: creds.baseUrl })
    if (res && res.ok && Array.isArray(res.models) && res.models.length) {
      availableModels = res.models
      window.UI.renderModelPanel(res.models)
      populateCompareModels()
    }
  }

  async function handleSettingsControl(e) {
    const id = e.target.id
    const val = e.target.value
    const checked = e.target.checked
    let patch = null
    if (id === 'set-font-size') patch = { fontSize: val }
    else if (id === 'set-line-height') patch = { lineHeight: val }
    else if (id === 'set-message-width') patch = { messageWidth: val }
    else if (id === 'set-input-rows') patch = { inputRows: Number(val) }
    else if (id === 'set-typing-anim') patch = { typingAnim: checked }
    else if (id === 'set-markdown') patch = { markdown: checked }
    else if (id === 'set-auto-title') patch = { autoTitle: checked }
    else if (id === 'set-notify-on-reply') patch = { notifyOnReply: checked }
    else if (id === 'set-shortcut-enabled') {
      patch = { shortcutEnabled: checked }
      window.dsDesktop.setShortcut(checked)
    }
    else if (id === 'set-auto-backup') patch = { autoBackup: checked }
    else if (id === 'set-language') patch = { language: val }
    else if (id === 'set-bg-fit') patch = { background: { fit: val } }
    else if (id === 'set-bg-dim') patch = { background: { dimDark: checked } }
    else if (id === 'set-bg-opacity') {
      $('#bg-opacity-val').textContent = val + '%'
      patch = { background: { opacity: Number(val) } }
    }
    if (id === 'set-api-key' || id === 'set-base-url') {
      const creds = window.Store.activeApiCreds()
      const key = id === 'set-api-key' ? val.trim() : creds.apiKey
      const baseUrl = id === 'set-base-url' ? val.trim() : creds.baseUrl
      await saveApiProfilePatch({ apiKey: key, baseUrl })
      loadModels()
      return
    }
    if (patch) {
      await updateSettings(patch)
      if (id === 'set-markdown' || id === 'set-font-size') {
        renderActive()
      }
    }
  }

  // ---------- API 档案 ----------
  async function saveApiProfilePatch(partial) {
    const s = window.Store.getSettings()
    let profiles = (s.apiProfiles || []).slice()
    let activeId = s.activeProfileId
    if (!profiles.length) {
      profiles.push({
        id: 'default',
        name: t('api_profile_default'),
        apiKey: partial.apiKey || '',
        baseUrl: partial.baseUrl || 'https://api.deepseek.com'
      })
      activeId = 'default'
    } else if (!activeId || !profiles.some((p) => p.id === activeId)) {
      activeId = profiles[0].id
    }
    profiles = profiles.map((p) => (p.id === activeId ? Object.assign({}, p, partial) : p))
    await updateSettings({ apiProfiles: profiles, activeProfileId: activeId })
  }

  const saveProfileNameDebounced = debounce(async (id, name) => {
    const s = window.Store.getSettings()
    const profiles = (s.apiProfiles || []).map((p) => (p.id === id ? Object.assign({}, p, { name }) : p))
    await updateSettings({ apiProfiles: profiles })
  }, 400)

  // ---------- 提示词 ----------
  function renderPromptPresets() {
    const list = $('#prompt-preset-list')
    if (!list) return
    const esc = (s) => window.MD.escapeHtml(s)
    const builtin = PROMPT_PRESETS.map((p) => {
      const label = window.I18N.t(p.labelKey)
      return `<button class="prompt-preset-chip" data-preset="${p.id}" title="${esc(label)}">${esc(label)}</button>`
    }).join('')
    const custom = (window.Store.getSettings().personas || [])
      .map(
        (p) =>
          `<span class="prompt-chip-wrap" draggable="true" data-persona-id="${esc(p.id)}"><button class="prompt-preset-chip custom" data-preset-id="${esc(p.id)}" title="${esc(p.name)}">${esc(p.name)}</button><button class="prompt-chip-edit" data-edit-id="${esc(p.id)}" title="${t('persona_edit')}">✎</button><button class="prompt-chip-del" data-del-id="${esc(p.id)}" title="${t('delete')}">&times;</button></span>`
      )
      .join('')
    list.innerHTML = builtin + custom
  }

  function applyPersonaToConv(conv, prompt) {
    $('#set-conversation-prompt').value = prompt || ''
    if (conv) {
      return window.Store.updateConversation(conv.id, { systemPrompt: prompt || '' })
    }
    return Promise.resolve()
  }

  function syncPromptPanel() {
    const ta = $('#set-conversation-prompt')
    const hint = $('#prompt-conv-hint')
    const conv = window.Store.getConversation(state.activeId)
    if (!conv) {
      ta.value = ''
      ta.disabled = true
      $('#prompt-apply-all').disabled = true
      hint.textContent = t('prompt_none_hint')
      return
    }
    ta.disabled = false
    $('#prompt-apply-all').disabled = false
    ta.value = conv.systemPrompt || ''
    hint.textContent = t('prompt_hint')
  }

  // ---------- 事件绑定 ----------
  const savePromptDebounced = debounce(async (id, value) => {
    const conv = window.Store.getConversation(id)
    if (conv) await window.Store.updateConversation(conv.id, { systemPrompt: value })
  }, 400)

  const saveParamsDebounced = debounce(async (id, p) => {
    const conv = window.Store.getConversation(id)
    if (conv) await window.Store.updateConversation(conv.id, { params: p })
  }, 400)

  const saveDraftDebounced = debounce(async (id, draft) => {
    const conv = window.Store.getConversation(id)
    if (conv) await window.Store.updateConversation(conv.id, { draft })
  }, 400)

  async function maybeAutoTitle(conv) {
    if (!conv) return
    const s = window.Store.getSettings()
    if (!s.autoTitle) return
    if (conv.title && conv.title !== t('first_msg_default')) return
    const firstUser = (conv.messages || []).find((m) => m.role === 'user' && m.content)
    if (!firstUser) return
    const creds = window.Store.activeApiCreds()
    if (!creds.apiKey) return
    const res = await window.dsDesktop.generateTitle({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      text: String(firstUser.content).slice(0, 800)
    })
    if (res && res.ok && res.title) {
      await window.Store.updateConversation(conv.id, { title: res.title.slice(0, 40) })
      window.UI.renderChatList()
    }
  }

  function getRegeneratePrompt(conv, assistantMsg) {
    if (conv.messages.length < 2) return null
    let idx = conv.messages.indexOf(assistantMsg)
    if (idx < 0) idx = conv.messages.length - 1
    for (let i = idx - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'user') return conv.messages[i]
    }
    return null
  }

  async function resendFrom(conv, userMsg, editedContent) {
    if (state.streaming) return
    if (userMsg) {
      if (editedContent !== undefined && editedContent !== null) {
        userMsg.content = editedContent
      }
      const aiIdx = conv.messages.indexOf(userMsg)
      if (aiIdx >= 0) conv.messages.splice(aiIdx + 1)
    }
    conv.draft = ''
    $('#chat-input').value = ''
    window.UI.resizeInput()
    await window.Store.saveConversations()
    window.UI.renderMessages()
    window.UI.renderChatList()
    await streamAnswer(conv)
  }

  async function regenerateMessage(conv, assistantMsg) {
    if (state.streaming) return
    const userMsg = getRegeneratePrompt(conv, assistantMsg)
    if (!userMsg) return

    const hasOldContent = !!(assistantMsg.content || assistantMsg.reasoning)
    if (hasOldContent || !Array.isArray(assistantMsg.variants)) {
      if (!Array.isArray(assistantMsg.variants)) assistantMsg.variants = []
      if (hasOldContent && !assistantMsg.error) {
        assistantMsg.variants.push(snapshotVariant(assistantMsg))
      }
    }

    assistantMsg.content = ''
    assistantMsg.reasoning = ''
    assistantMsg.searched = false
    assistantMsg.usage = null
    delete assistantMsg.error

    conv.draft = ''
    $('#chat-input').value = ''
    window.UI.resizeInput()
    await window.Store.saveConversations()
    window.UI.renderMessages()
    await streamAnswer(conv, { msg: assistantMsg })
  }

  async function deleteMessage(conv, msg) {
    if (state.streaming) return
    const idx = conv.messages.indexOf(msg)
    if (idx < 0) return
    if (msg.role === 'assistant') {
      conv.messages.splice(idx, 1)
    } else {
      const nextMsg = conv.messages[idx + 1]
      if (nextMsg && nextMsg.role === 'assistant') {
        conv.messages.splice(idx, 2)
      } else {
        conv.messages.splice(idx, 1)
      }
    }
    await window.Store.saveConversations()
    window.UI.renderMessages()
    window.UI.renderChatList()
  }

  function handleMessageAction(e) {
    const btn = e.target.closest('.act-btn')
    if (!btn) return
    const conv = window.Store.getConversation(state.activeId)
    if (!conv) return
    const msg = conv.messages.find((m) => m._id === btn.dataset.id)
    if (!msg) return
    const act = btn.dataset.act
    if (act === 'copy') {
      window.MD.copyText(msg.content || '')
      window.UI.toast(t('copied'))
    } else if (act === 'speak') {
      toggleSpeak(msg.content || '')
    } else if (act === 'regenerate') {
      regenerateMessage(conv, msg)
    } else if (act === 'editmsg') {
      startEditMessage(conv, msg)
    } else if (act === 'delmsg') {
      deleteMessage(conv, msg)
    } else if (act === 'prevver' || act === 'nextver') {
      switchVersion(conv, msg, act === 'prevver' ? -1 : 1)
    }
  }

  function snapshotVariant(msg) {
    return {
      content: msg.content || '',
      reasoning: msg.reasoning || '',
      searched: !!msg.searched,
      usage: msg.usage || null,
      ts: msg.ts || Date.now()
    }
  }

  function applyVariant(msg, v) {
    if (!v) return
    msg.content = v.content || ''
    msg.reasoning = v.reasoning || ''
    msg.searched = !!v.searched
    msg.usage = v.usage || null
    msg.ts = v.ts || msg.ts
  }

  async function switchVersion(conv, msg, delta) {
    const variants = Array.isArray(msg.variants) ? msg.variants : []
    if (!variants.length) return
    let idx = typeof msg.vindex === 'number' ? msg.vindex : variants.length - 1
    idx = Math.min(variants.length - 1, Math.max(0, idx + delta))
    msg.vindex = idx
    applyVariant(msg, variants[idx])
    delete msg.error
    await window.Store.saveConversations()
    window.UI.renderMessages()
  }

  let currentSpeak = null
  function toggleSpeak(text) {
    const synth = window.speechSynthesis
    if (!synth) return
    if (currentSpeak && synth.speaking) {
      synth.cancel()
      currentSpeak = null
      return
    }
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    const voices = synth.getVoices()
    const zh = voices.find((v) => /zh|cmn/i.test(v.lang))
    if (zh) u.voice = zh
    u.rate = 1
    u.pitch = 1
    u.onend = () => (currentSpeak = null)
    u.onerror = () => (currentSpeak = null)
    currentSpeak = u
    synth.speak(u)
  }

  function startEditMessage(conv, msg) {
    const node = $('#messages').querySelector(`.act-btn[data-act="editmsg"][data-id="${msg._id}"]`)
    if (!node) return
    const bubble = node.closest('.msg')
    if (!bubble) return
    const contentEl = bubble.querySelector('.msg-content')
    if (!contentEl) return
    const ta = document.createElement('textarea')
    ta.className = 'edit-ta'
    ta.value = msg.content || ''
    const send = document.createElement('button')
    send.className = 'btn primary small edit-send'
    send.textContent = t('resend')
    const cancel = document.createElement('button')
    cancel.className = 'btn small'
    cancel.textContent = t('cancel')
    const bar = document.createElement('div')
    bar.className = 'edit-bar'
    bar.appendChild(send)
    bar.appendChild(cancel)
    contentEl.replaceWith(ta)
    const origActions = bubble.querySelector('.msg-actions')
    if (origActions) origActions.style.display = 'none'
    bubble.appendChild(bar)
    const cleanup = () => {
      ta.remove()
      bar.remove()
      if (origActions) origActions.style.display = ''
      window.UI.renderMessages()
    }
    send.addEventListener('click', async () => {
      const newText = ta.value.trim()
      if (!newText) return
      cleanup()
      await resendFrom(conv, msg, newText)
    })
    cancel.addEventListener('click', cleanup)
    ta.focus()
    ta.select()
  }

  function bindEvents() {
    // 新对话
    $('#new-chat-btn').addEventListener('click', async () => {
      if (state.streaming) window.Api.abort()
      resetTrashMode()
      const conv = await window.Store.createConversation(lastModel, {
        thinking: $('#thinking-toggle').checked,
        search: $('#search-toggle').checked
      })
      state.activeId = conv.id
      window.UI.renderChatList()
      renderActive()
      focusInput()
    })

    // 会话列表
    $('#chat-list').addEventListener('click', (e) => {
      const item = e.target.closest('.chat-item')
      if (!item) return
      const id = item.dataset.id
      if (state.trashMode) {
        if (e.target.closest('.op-restore')) {
          restoreFromTrash(id)
          return
        }
        if (e.target.closest('.op-delete')) {
          purgeFromTrash(id)
          return
        }
        return
      }
      if (e.target.closest('.op-rename')) {
        openRename(id)
        return
      }
      if (e.target.closest('.op-export')) {
        exportConversation(id)
        return
      }
      if (e.target.closest('.op-delete')) {
        deleteConversation(id)
        return
      }
      if (e.target.closest('.op-pin')) {
        window.Store.togglePin(id).then(() => window.UI.renderChatList())
        return
      }
      if (e.target.closest('.op-folder')) {
        openFolderModal(id)
        return
      }
      if (id !== state.activeId) switchConversation(id)
    })

    // 分组折叠 / 删除分组
    $('#chat-list').addEventListener('click', async (e) => {
      const head = e.target.closest('.folder-head')
      if (!head) return
      const name = head.dataset.folder
      if (e.target.closest('.folder-del')) {
        askConfirm(t('remove_folder_confirm').replace('{name}', name), async () => {
          const convs = window.Store.getConversations()
          for (const c of convs) {
            if (c.folder === name) await window.Store.setFolder(c.id, '')
          }
          window.UI.state.collapsedFolders.delete(name)
          window.UI.renderChatList()
        })
        return
      }
      const set = window.UI.state.collapsedFolders
      if (set.has(name)) set.delete(name)
      else set.add(name)
      window.UI.renderChatList()
    })

    // 清空回收站
    $('#chat-list').addEventListener('click', (e) => {
      const empty = e.target.closest('.trash-empty')
      if (!empty) return
      askConfirm(t('confirm_empty_trash'), async () => {
        await window.Store.emptyTrash()
        window.UI.renderChatList()
      })
    })

    // 会话搜索
    const chatSearch = $('#chat-search')
    chatSearch.addEventListener('input', () => {
      const kw = chatSearch.value.trim().toLowerCase()
      state.chatSearch = kw
      window.UI.renderChatList()
    })
    chatSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        chatSearch.value = ''
        state.chatSearch = ''
        window.UI.renderChatList()
      }
    })

    // 发送 / 停止
    $('#send-btn').addEventListener('click', () => {
      if (state.streaming) {
        window.Api.abort()
      } else {
        sendMessage()
      }
    })

    // 点击输入框任意位置聚焦（发送按钮除外）
    $('#input-shell').addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      $('#chat-input').focus()
    })

    $('#chat-input').addEventListener('input', () => {
      window.UI.resizeInput()
      updateInputTip(false)
      const conv = window.Store.getConversation(state.activeId)
      if (conv) saveDraftDebounced(conv.id, $('#chat-input').value)
    })
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    })

    // 附加文件/图片
    $('#attach-btn').addEventListener('click', async () => {
      const res = await window.dsDesktop.openAttachment()
      if (!res || !res.ok) return
      insertAttachment(res)
    })

    // 导入对话
    $('#import-conv-btn').addEventListener('click', async () => {
      const res = await window.dsDesktop.openConversation()
      if (!res || !res.ok) return
      let data = null
      try {
        data = JSON.parse(res.content)
      } catch {
        data = null
      }
      if (!data) {
        window.UI.toast(t('conv_import_failed'))
        return
      }
      const conv = await window.Store.createConversation(data.model || lastModel, {
        title: data.title || t('first_msg_default'),
        thinking: data.thinking !== false,
        search: !!data.search,
        systemPrompt: data.systemPrompt || '',
        params: data.params || { temperature: 1, top_p: 1, max_tokens: 8192, effort: 'medium' },
        messages: Array.isArray(data.messages) ? data.messages : []
      })
      state.activeId = conv.id
      resetTrashMode()
      window.UI.renderChatList()
      renderActive()
      window.UI.toast(t('conv_imported'))
    })

    // 欢迎页建议卡片
    $('#messages').addEventListener('click', (e) => {
      const card = e.target.closest('.welcome-card')
      if (card) {
        $('#chat-input').value = card.textContent.trim()
        $('#chat-input').focus()
        window.UI.resizeInput()
      }
    })

    // 消息区：外链 & 复制
    $('#messages').addEventListener('click', (e) => {
      const link = e.target.closest('a[target="_blank"]')
      if (link) {
        e.preventDefault()
        window.dsDesktop.openExternal(link.href)
        return
      }
      const copyBtn = e.target.closest('.copy-btn')
      if (copyBtn) {
        const pre = copyBtn.closest('.code-block').querySelector('.code-body > pre')
        if (pre) {
          window.MD.copyText(pre.textContent)
          window.UI.toast(t('copied'))
        }
        return
      }
      const actBtn = e.target.closest('.act-btn')
      if (actBtn) {
        handleMessageAction(e)
      }
    })

    // 模型选择
    $('#model-select').addEventListener('click', (e) => {
      e.stopPropagation()
      window.UI.openPopover($('#model-panel'), $('#model-select'))
    })
    $('#model-panel').addEventListener('click', async (e) => {
      const opt = e.target.closest('.model-opt')
      if (!opt) return
      const model = opt.dataset.model
      lastModel = model
      const conv = window.Store.getConversation(state.activeId)
      if (conv) {
        await window.Store.updateConversation(conv.id, { model })
        syncHeader(conv)
      }
      window.UI.closePopovers()
    })

    // 深度思考
    $('#thinking-toggle').addEventListener('change', async (e) => {
      const conv = window.Store.getConversation(state.activeId)
      if (conv) {
        await window.Store.updateConversation(conv.id, { thinking: e.target.checked })
      }
    })

    // 联网搜索
    $('#search-toggle').addEventListener('change', async (e) => {
      const conv = window.Store.getConversation(state.activeId)
      if (conv) {
        await window.Store.updateConversation(conv.id, { search: e.target.checked })
      }
    })

    // 多模型对比
    $('#compare-toggle').addEventListener('change', async (e) => {
      const conv = window.Store.getConversation(state.activeId)
      if (!conv) return
      $('#compare-model-select').disabled = !e.target.checked
      const patch = { compareEnabled: e.target.checked }
      if (e.target.checked && !conv.compareModel && $('#compare-model-select').value) {
        patch.compareModel = $('#compare-model-select').value
      }
      await window.Store.updateConversation(conv.id, patch)
    })
    $('#compare-model-select').addEventListener('change', async (e) => {
      const conv = window.Store.getConversation(state.activeId)
      if (conv && e.target.value) {
        await window.Store.updateConversation(conv.id, { compareModel: e.target.value })
      }
    })

    // 参数
    $('#params-btn').addEventListener('click', (e) => {
      e.stopPropagation()
      const conv = window.Store.getConversation(state.activeId)
      if (conv) syncHeader(conv)
      window.UI.openPopover($('#params-panel'), $('#params-btn'))
    })

    $('#param-temp').addEventListener('input', (e) => {
      $('#param-temp-val').textContent = Number(e.target.value).toFixed(1)
    })
    $('#param-top-p').addEventListener('input', (e) => {
      $('#param-top-p-val').textContent = Number(e.target.value).toFixed(2)
    })
    $('#params-panel').addEventListener('input', (e) => {
      const conv = window.Store.getConversation(state.activeId)
      if (!conv) return
      const p = Object.assign({}, conv.params)
      if (e.target.id === 'param-temp') p.temperature = Number(e.target.value)
      else if (e.target.id === 'param-top-p') p.top_p = Number(e.target.value)
      else if (e.target.id === 'param-max-tokens') p.max_tokens = Number(e.target.value) || 8192
      else if (e.target.id === 'param-effort') p.effort = e.target.value
      conv.params = p
      saveParamsDebounced(conv.id, p)
    })

    // 主题快捷切换
    $('#theme-quick-btn').addEventListener('click', async () => {
      const s = window.Store.getSettings()
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
      await updateSettings({ theme: next })
    })

    // 最近删除
    $('#trash-btn').addEventListener('click', () => {
      setTrashMode(!state.trashMode)
    })

    // 设置面板开关
    $('#settings-btn').addEventListener('click', () => {
      window.UI.syncSettingsPanel(window.Store.getSettings())
      syncPromptPanel()
      $('#settings-modal').hidden = false
    })
    $('#settings-close').addEventListener('click', () => ($('#settings-modal').hidden = true))
    $('#settings-modal').addEventListener('click', (e) => {
      if (e.target === $('#settings-modal')) $('#settings-modal').hidden = true
    })
    $('#settings-reset').addEventListener('click', async () => {
      const st = await window.Store.resetSettings()
      window.UI.applyAll(st)
      window.UI.syncSettingsPanel(st)
      window.Store.applyLanguage(st.language)
      renderActive()
    })

    // 设置 tabs
    $$tabs('.settings-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$tabs('.settings-tabs .tab-btn').forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        $$tabs('.tab-pane').forEach((p) => p.classList.remove('active'))
        document.querySelector(`.tab-pane[data-pane="${btn.dataset.tab}"]`).classList.add('active')
        if (btn.dataset.tab === 'prompt') syncPromptPanel()
      })
    })

    // 提示词：预设、自定义人设与全部应用
    $('#prompt-preset-list').addEventListener('click', async (e) => {
      const edit = e.target.closest('.prompt-chip-edit')
      if (edit) {
        const persona = (window.Store.getSettings().personas || []).find((p) => p.id === edit.dataset.editId)
        if (!persona) return
        $('#persona-name').value = persona.name
        $('#persona-prompt').value = persona.prompt
        $('#persona-modal').dataset.editId = persona.id
        $('#persona-modal-title').textContent = t('persona_edit')
        $('#persona-ok').textContent = t('save')
        $('#persona-modal').hidden = false
        $('#persona-name').focus()
        return
      }
      const del = e.target.closest('.prompt-chip-del')
      if (del) {
        const persona = (window.Store.getSettings().personas || []).find((p) => p.id === del.dataset.delId)
        if (!persona) return
        askConfirm(t('prompt_delete_persona_message').replace('{name}', persona.name), async () => {
          const s = window.Store.getSettings()
          await updateSettings({ personas: (s.personas || []).filter((p) => p.id !== persona.id) })
          renderPromptPresets()
        })
        return
      }
      const chip = e.target.closest('.prompt-preset-chip')
      if (!chip) return
      let conv = window.Store.getConversation(state.activeId)
      if (!conv) {
        conv = await window.Store.createConversation(lastModel, {
          thinking: $('#thinking-toggle').checked,
          search: $('#search-toggle').checked
        })
        state.activeId = conv.id
        window.UI.renderChatList()
        renderActive()
      }
      if (chip.dataset.preset) {
        const preset = PROMPT_PRESETS.find((p) => p.id === chip.dataset.preset)
        if (!preset) return
        await applyPersonaToConv(conv, preset.prompt)
      } else if (chip.dataset.presetId) {
        const persona = (window.Store.getSettings().personas || []).find((p) => p.id === chip.dataset.presetId)
        if (!persona) return
        await applyPersonaToConv(conv, persona.prompt)
      }
    })

    $('#set-conversation-prompt').addEventListener('input', (e) => {
      const conv = window.Store.getConversation(state.activeId)
      if (!conv) return
      conv.systemPrompt = e.target.value
      savePromptDebounced(conv.id, e.target.value)
    })

    // 新增自定义人设
    $('#prompt-add-custom').addEventListener('click', () => {
      $('#persona-name').value = ''
      $('#persona-prompt').value = ''
      delete $('#persona-modal').dataset.editId
      $('#persona-modal-title').textContent = t('persona_create')
      $('#persona-ok').textContent = t('persona_add')
      $('#persona-modal').hidden = false
      $('#persona-name').focus()
    })

    // 拖拽排序人设
    let dragPersonaId = null
    $('#prompt-preset-list').addEventListener('dragstart', (e) => {
      const wrap = e.target.closest('.prompt-chip-wrap')
      if (!wrap) return
      dragPersonaId = wrap.dataset.personaId
      wrap.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
      try {
        e.dataTransfer.setData('text/plain', dragPersonaId)
      } catch {
        /* noop */
      }
    })
    $('#prompt-preset-list').addEventListener('dragend', () => {
      $$tabs('#prompt-preset-list .prompt-chip-wrap').forEach((w) => w.classList.remove('dragging'))
      dragPersonaId = null
    })
    $('#prompt-preset-list').addEventListener('dragover', (e) => {
      const wrap = e.target.closest('.prompt-chip-wrap')
      if (!wrap) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const list = $('#prompt-preset-list')
      const items = $$tabs('#prompt-preset-list .prompt-chip-wrap')
      const targetIndex = items.indexOf(wrap)
      const draggingIndex = items.findIndex((w) => w.classList.contains('dragging'))
      if (draggingIndex >= 0 && targetIndex >= 0 && draggingIndex !== targetIndex) {
        const dragging = items[draggingIndex]
        if (targetIndex < draggingIndex) list.insertBefore(dragging, wrap)
        else list.insertBefore(dragging, wrap.nextSibling)
      }
    })
    $('#prompt-preset-list').addEventListener('drop', async (e) => {
      e.preventDefault()
      const id = dragPersonaId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '')
      if (!id) return
      const s = window.Store.getSettings()
      const personas = (s.personas || []).slice()
      const from = personas.findIndex((p) => p.id === id)
      if (from < 0) return
      const order = $$tabs('#prompt-preset-list .prompt-chip-wrap').map((w) => w.dataset.personaId)
      const to = order.indexOf(id)
      if (to < 0 || to === from) return
      personas.splice(to, 0, personas.splice(from, 1)[0])
      await updateSettings({ personas })
    })

    $('#persona-ok').addEventListener('click', async () => {
      const name = $('#persona-name').value.trim()
      const prompt = $('#persona-prompt').value.trim()
      if (!name || !prompt) {
        window.UI.toast(t('prompt_need_fields'))
        return
      }
      const editId = $('#persona-modal').dataset.editId
      const s = window.Store.getSettings()
      let personas = (s.personas || []).slice()
      if (editId) {
        const idx = personas.findIndex((p) => p.id === editId)
        if (idx >= 0) personas[idx] = Object.assign({}, personas[idx], { name, prompt })
      } else {
        personas.push({ id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, prompt })
      }
      await updateSettings({ personas })
      $('#persona-modal').hidden = true
      delete $('#persona-modal').dataset.editId
      renderPromptPresets()
      const conv = window.Store.getConversation(state.activeId)
      await applyPersonaToConv(conv, prompt)
    })

    $('#persona-cancel').addEventListener('click', () => {
      $('#persona-modal').hidden = true
    })

    $('#persona-prompt').addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        $('#persona-ok').click()
      }
    })

    // 应用到所有对话
    $('#prompt-apply-all').addEventListener('click', async () => {
      if (!window.Store.getConversation(state.activeId)) return
      const value = $('#set-conversation-prompt').value
      const convs = window.Store.getConversations()
      for (const c of convs) {
        await window.Store.updateConversation(c.id, { systemPrompt: value })
      }
      window.UI.toast(t('prompt_applied'))
    })

    // 导入人设
    $('#prompt-import').addEventListener('click', async () => {
      const res = await window.dsDesktop.openPersonas()
      if (!res.ok) return
      let items = []
      try {
        const parsed = JSON.parse(res.content)
        items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.personas) ? parsed.personas : []
      } catch {
        items = []
      }
      items = items.filter((p) => p && p.name && p.prompt)
      if (!items.length) {
        window.UI.toast(t('persona_import_failed'))
        return
      }
      const s = window.Store.getSettings()
      const existing = new Set((s.personas || []).map((p) => p.name))
      const added = items.filter((p) => !existing.has(p.name))
      const personas = (s.personas || []).slice()
      for (const p of added) {
        personas.push({
          id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: p.name,
          prompt: p.prompt
        })
      }
      await updateSettings({ personas })
      renderPromptPresets()
      window.UI.toast(t('persona_imported').replace('{n}', String(added.length)))
    })

    // 导出人设
    $('#prompt-export').addEventListener('click', async () => {
      const personas = window.Store.getSettings().personas || []
      const payload = JSON.stringify({ version: 1, personas }, null, 2)
      const res = await window.dsDesktop.savePersonas(payload)
      if (res.ok) window.UI.toast(t('persona_exported'))
    })

    // 分段控件（设置面板内）
    document.querySelectorAll('.settings-modal .segmented, .segmented').forEach((seg) => {
      if (!seg.id) return
      seg.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-val]')
        if (!btn) return
        const id = seg.id
        let patch = null
        if (id === 'theme-mode-seg') patch = { theme: btn.dataset.val }
        else if (id === 'code-theme-seg') patch = { codeTheme: btn.dataset.val }
        else if (id === 'bubble-style-seg') {
          patch = { bubbleStyle: btn.dataset.val }
          renderActive()
        } else if (id === 'bg-type-seg') {
          patch = { background: { type: btn.dataset.val } }
        }
        if (patch) await updateSettings(patch)
      })
    })

    // 强调色
    $('#accent-swatches').addEventListener('click', async (e) => {
      const sw = e.target.closest('.swatch[data-color]')
      if (sw) await updateSettings({ accent: sw.dataset.color })
    })
    $('#accent-custom').addEventListener('input', async (e) => {
      await updateSettings({ accent: e.target.value })
    })

    // 背景纯色
    $('#bg-color-section').addEventListener('click', async (e) => {
      const sw = e.target.closest('.swatch[data-bgcolor]')
      if (sw) await updateSettings({ background: { value: sw.dataset.bgcolor, type: 'color' } })
    })
    $('#bg-color-custom').addEventListener('input', async (e) => {
      await updateSettings({ background: { value: e.target.value, type: 'color' } })
    })

    // 背景渐变
    $('#bg-gradient-section').addEventListener('click', async (e) => {
      const opt = e.target.closest('.gradient-opt')
      if (opt) await updateSettings({ background: { value: opt.dataset.gradient, type: 'gradient' } })
    })

    // 背景图上传
    $('#bg-upload-btn').addEventListener('click', async () => {
      const res = await window.dsDesktop.uploadBackground()
      if (!res.ok) {
        window.UI.toast(res.error || t('err_network'))
        return
      }
      const s = window.Store.getSettings()
      const images = (s.background.images || []).filter((p) => p.path !== res.path)
      images.push({ path: res.path, addedAt: Date.now() })
      await updateSettings({
        background: { type: 'image', value: res.path, images }
      })
    })

    // 背景图列表
    $('#bg-image-list').addEventListener('click', async (e) => {
      const thumb = e.target.closest('.bg-image-thumb')
      if (!thumb) return
      if (e.target.closest('.del')) {
        const s = window.Store.getSettings()
        const images = (s.background.images || []).filter((p) => p.path !== thumb.dataset.path)
        const patch = { images }
        if (s.background.value === thumb.dataset.path) {
          patch.type = 'none'
          patch.value = null
        }
        await updateSettings({ background: patch })
        return
      }
      await updateSettings({ background: { value: thumb.dataset.path, type: 'image' } })
    })

    // 界面设置控件
    document
      .querySelectorAll('#settings-modal .select, #settings-modal input[type="checkbox"], #set-bg-opacity')
      .forEach((ctl) => {
        ctl.addEventListener('change', handleSettingsControl)
        if (ctl.id === 'set-bg-opacity') ctl.addEventListener('input', handleSettingsControl)
      })

    // API Key / Base URL
    $('#set-api-key').addEventListener('change', handleSettingsControl)
    $('#set-base-url').addEventListener('change', handleSettingsControl)
    $('#get-key-btn').addEventListener('click', () => window.dsDesktop.openExternal('https://platform.deepseek.com'))

    // API 档案
    async function createApiProfile() {
      const s = window.Store.getSettings()
      const profiles = (s.apiProfiles || []).slice()
      const p = {
        id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: t('api_profile_new'),
        apiKey: '',
        baseUrl: 'https://api.deepseek.com'
      }
      await updateSettings({ apiProfiles: profiles.concat(p), activeProfileId: p.id })
      window.UI.syncSettingsPanel(window.Store.getSettings())
      const nameInput = $('#api-profile-name')
      nameInput.value = ''
      nameInput.focus()
      nameInput.select()
    }
    $('#api-profile').addEventListener('change', async (e) => {
      const id = e.target.value
      if (id === '__new__') {
        await createApiProfile()
        return
      }
      await updateSettings({ activeProfileId: id })
      window.UI.syncSettingsPanel(window.Store.getSettings())
    })
    $('#api-profile-new').addEventListener('click', createApiProfile)
    $('#api-profile-name').addEventListener('input', (e) => {
      const s = window.Store.getSettings()
      if (s.activeProfileId && s.activeProfileId !== 'default') {
        saveProfileNameDebounced(s.activeProfileId, e.target.value)
      }
    })
    $('#api-profile-del').addEventListener('click', async () => {
      const s = window.Store.getSettings()
      const profiles = (s.apiProfiles || []).slice()
      if (!profiles.length) return
      const active = profiles.find((p) => p.id === s.activeProfileId)
      if (!active) return
      askConfirm(t('api_profile_del_message').replace('{name}', active.name), async () => {
        const rest = profiles.filter((p) => p.id !== active.id)
        const patch = { apiProfiles: rest }
        if (rest.length) {
          patch.activeProfileId = rest[0].id
        } else {
          patch.activeProfileId = ''
        }
        await updateSettings(patch)
        window.UI.syncSettingsPanel(window.Store.getSettings())
      })
    })

    // 模式切换
    $('#mode-toggle-btn').addEventListener('click', () => window.UI.setWebMode(!state.webMode))
    $('#back-to-api').addEventListener('click', () => window.UI.setWebMode(false))

    // webview
    const webview = $('#deepseek-webview')
    const ALLOWED_WEBVIEW_HOSTS = ['chat.deepseek.com']
    const isAllowedWebview = (url) => {
      try {
        const h = new URL(url).hostname
        return ALLOWED_WEBVIEW_HOSTS.some((a) => h === a || h.endsWith('.' + a))
      } catch {
        return false
      }
    }
    const syncStatus = () => {
      const title = webview.getTitle ? webview.getTitle() : ''
      $('#webview-status').textContent = title || ''
    }
    webview.addEventListener('will-navigate', (e) => {
      if (!isAllowedWebview(e.url)) {
        e.preventDefault()
        window.dsDesktop.openExternal(e.url)
      }
    })
    webview.addEventListener('new-window', (e) => {
      if (!isAllowedWebview(e.url)) {
        e.preventDefault()
        window.dsDesktop.openExternal(e.url)
      }
    })
    webview.addEventListener('dom-ready', () => {
      $('#webview-loading').style.display = 'none'
      syncStatus()
    })
    webview.addEventListener('did-navigate', () => syncStatus())
    webview.addEventListener('did-navigate-in-page', () => syncStatus())
    webview.addEventListener('page-title-updated', () => syncStatus())
    webview.addEventListener('did-start-loading', () => {
      $('#webview-loading').style.display = 'flex'
    })
    webview.addEventListener('did-stop-loading', () => {
      $('#webview-loading').style.display = 'none'
    })

    // ---------- 会话内搜索 ----------
    let msgSearchMarks = []
    let msgSearchIdx = -1

    function updateSearchCount() {
      const el = $('#msg-search-count')
      if (msgSearchMarks.length) {
        el.textContent = `${Math.max(0, msgSearchIdx + 1)}/${msgSearchMarks.length}`
      } else {
        el.textContent = $('#msg-search-input').value.trim() ? '0/0' : ''
      }
    }

    function clearMsgSearchMarks() {
      document.querySelectorAll('#messages mark.msg-search-hit').forEach((m) => {
        const parent = m.parentNode
        if (!parent) return
        parent.replaceChild(document.createTextNode(m.textContent), m)
        parent.normalize()
      })
      document.querySelectorAll('#messages mark.msg-search-hit-active').forEach((m) => m.classList.remove('msg-search-hit-active'))
      msgSearchMarks = []
      msgSearchIdx = -1
      updateSearchCount()
    }

    function escapeRegExp(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    function performMsgSearch() {
      clearMsgSearchMarks()
      const kw = $('#msg-search-input').value.trim()
      if (!kw || window.UI.state.streaming) {
        updateSearchCount()
        return
      }
      const walker = document.createTreeWalker($('#messages'), NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
          const p = node.parentElement
          if (!p) return NodeFilter.FILTER_REJECT
          if (p.closest('.mermaid')) return NodeFilter.FILTER_REJECT
          return node.nodeValue.toLowerCase().includes(kw.toLowerCase())
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT
        }
      })
      const nodes = []
      let n
      while ((n = walker.nextNode())) nodes.push(n)
      const re = new RegExp(escapeRegExp(kw), 'gi')
      nodes.forEach((textNode) => {
        const frag = document.createDocumentFragment()
        let last = 0
        let match
        re.lastIndex = 0
        while ((match = re.exec(textNode.nodeValue))) {
          frag.appendChild(document.createTextNode(textNode.nodeValue.slice(last, match.index)))
          const mark = document.createElement('mark')
          mark.className = 'msg-search-hit'
          mark.textContent = match[0]
          frag.appendChild(mark)
          last = match.index + match[0].length
          if (match[0].length === 0) re.lastIndex += 1
        }
        frag.appendChild(document.createTextNode(textNode.nodeValue.slice(last)))
        textNode.parentNode.replaceChild(frag, textNode)
      })
      msgSearchMarks = Array.from(document.querySelectorAll('#messages mark.msg-search-hit'))
      if (msgSearchMarks.length) {
        msgSearchIdx = 0
        activateSearchMark()
      }
      updateSearchCount()
    }

    function activateSearchMark() {
      msgSearchMarks.forEach((m, i) => {
        m.classList.toggle('msg-search-hit-active', i === msgSearchIdx)
        if (i === msgSearchIdx) {
          m.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      })
      updateSearchCount()
    }

    function openMsgSearch() {
      $('#msg-search-bar').hidden = false
      $('#msg-search-input').focus()
      $('#msg-search-input').select()
      performMsgSearch()
    }

    function closeMsgSearch() {
      $('#msg-search-bar').hidden = true
      clearMsgSearchMarks()
    }

    $('#msg-search-btn').addEventListener('click', () => {
      if ($('#msg-search-bar').hidden) openMsgSearch()
      else closeMsgSearch()
    })
    $('#msg-search-close').addEventListener('click', closeMsgSearch)
    $('#msg-search-next').addEventListener('click', () => {
      if (!msgSearchMarks.length) return
      msgSearchIdx = (msgSearchIdx + 1) % msgSearchMarks.length
      activateSearchMark()
    })
    $('#msg-search-prev').addEventListener('click', () => {
      if (!msgSearchMarks.length) return
      msgSearchIdx = (msgSearchIdx - 1 + msgSearchMarks.length) % msgSearchMarks.length
      activateSearchMark()
    })

    let msgSearchTimer = null
    $('#msg-search-input').addEventListener('input', () => {
      clearTimeout(msgSearchTimer)
      msgSearchTimer = setTimeout(performMsgSearch, 200)
    })
    $('#msg-search-input').addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) $('#msg-search-prev').click()
        else $('#msg-search-next').click()
      }
    })

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'f') {
        const activeConv = window.Store.getConversation(state.activeId)
        if (activeConv && activeConv.messages.length && !state.webMode) {
          e.preventDefault()
          openMsgSearch()
        }
      }
    })

    // ---------- 用量统计 ----------
    function fmtTokens(n) {
      return Number(n || 0).toLocaleString()
    }

    async function openStatsModal() {
      const s = window.Store.computeUsageStats()
      $('#stat-today').textContent = fmtTokens(s.today.total)
      $('#stat-week').textContent = fmtTokens(s.week.total)
      $('#stat-all').textContent = fmtTokens(s.all.total)
      $('#stat-detail').textContent = t('stats_detail')
        .replace('{today}', fmtTokens(s.today.prompt))
        .replace('{todayOut}', fmtTokens(s.today.completion))
        .replace('{count}', String(s.all.count))
      const tbody = $('#stats-by-model')
      const rows = Object.entries(s.byModel).sort((a, b) => b[1].total - a[1].total)
      tbody.innerHTML = rows.length
        ? rows
            .map(
              ([model, u]) =>
                `<tr><td>${window.UI.esc(MODEL_LABELS[model] || model)}</td><td>${fmtTokens(u.prompt)}</td><td>${fmtTokens(u.completion)}</td><td>${fmtTokens(u.total)}</td></tr>`
            )
            .join('')
        : `<tr><td colspan="4" class="stats-empty">${window.UI.esc(t('stats_empty'))}</td></tr>`
      $('#stats-modal').hidden = false
    }

    $('#stats-btn').addEventListener('click', openStatsModal)
    $('#stats-close').addEventListener('click', () => ($('#stats-modal').hidden = true))
    $('#stats-modal').addEventListener('click', (e) => {
      if (e.target === $('#stats-modal')) $('#stats-modal').hidden = true
    })

    // ---------- 拖拽附加文件 ----------
    function insertAttachment(res) {
      const ta = $('#chat-input')
      const tip = $('#attach-pending')
      const name = res.name || ''
      let token
      if (res.type === 'image') {
        token = `[图片附件：${name}]\n`
        tip.textContent = t('attach_image_note').replace('{name}', name)
      } else {
        token = `[文件：${name}]\n\`\`\`\n${(res.content || '').slice(0, 20000)}\n\`\`\`\n`
        tip.textContent = t('attach_text_note').replace('{name}', name)
      }
      const pos = ta.selectionStart || ta.value.length
      ta.value = ta.value.slice(0, pos) + token + ta.value.slice(pos)
      tip.hidden = false
      clearTimeout(insertAttachment._timer)
      insertAttachment._timer = setTimeout(() => (tip.hidden = true), 3000)
      window.UI.resizeInput()
      window.UI.scrollToBottom(true)
      updateInputTip(false)
      const conv = window.Store.getConversation(state.activeId)
      if (conv) saveDraftDebounced(conv.id, ta.value)
    }

    ;['dragenter', 'dragover'].forEach((ev) =>
      document.addEventListener(ev, (e) => {
        if (state.webMode) return
        e.preventDefault()
        $('#input-shell').classList.add('drag-over')
      })
    )
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) $('#input-shell').classList.remove('drag-over')
    })
    document.addEventListener('drop', async (e) => {
      $('#input-shell').classList.remove('drag-over')
      if (state.webMode) return
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files).slice(0, 5)
      for (const f of files) {
        const filePath = window.dsDesktop.getPathForFile(f)
        if (!filePath) continue
        const res = await window.dsDesktop.openAttachmentPath(filePath)
        if (res && res.ok) insertAttachment(res)
        else if (res && res.error) window.UI.toast(res.error)
      }
    })

    // ---------- 全局快捷键录制 ----------
    let recordingShortcut = false

    function acceleratorFromEvent(e) {
      const parts = []
      if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      const k = e.key
      if (!k) return null
      if (/^[a-zA-Z]$/.test(k)) parts.push(k.toUpperCase())
      else if (/^[0-9]$/.test(k)) parts.push(k)
      else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) parts.push(k)
      else if (k === 'ArrowUp') parts.push('Up')
      else if (k === 'ArrowDown') parts.push('Down')
      else if (k === 'ArrowLeft') parts.push('Left')
      else if (k === 'ArrowRight') parts.push('Right')
      else if (['Tab', 'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(k)) parts.push(k)
      else return null
      return parts.join('+')
    }

    function stopShortcutRecording(cancelled) {
      recordingShortcut = false
      const btn = $('#shortcut-record-btn')
      btn.textContent = t('record_shortcut')
      btn.classList.remove('recording')
      if (cancelled) syncSettingsPanelShortcutHint()
    }

    function syncSettingsPanelShortcutHint() {
      const s = window.Store.getSettings()
      $('#set-shortcut-accel').value = s.shortcutAccelerator || 'CommandOrControl+Alt+D'
    }

    $('#shortcut-record-btn').addEventListener('click', () => {
      if (recordingShortcut) {
        stopShortcutRecording(true)
        return
      }
      recordingShortcut = true
      const btn = $('#shortcut-record-btn')
      btn.textContent = t('recording_shortcut')
      btn.classList.add('recording')
      $('#set-shortcut-accel').value = t('press_keys')
    })

    document.addEventListener('keydown', async (e) => {
      if (!recordingShortcut) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        stopShortcutRecording(true)
        return
      }
      const accel = acceleratorFromEvent(e)
      if (!accel) return
      stopShortcutRecording(false)
      $('#set-shortcut-accel').value = accel
      await updateSettings({ shortcutAccelerator: accel })
      const s = window.Store.getSettings()
      const res = await window.dsDesktop.setShortcut(s.shortcutEnabled !== false, accel)
      if (res && res.ok) window.UI.toast(t('shortcut_saved'))
      else window.UI.toast(t('shortcut_failed'))
    }, true)

    // ---------- 备份 ----------
    async function refreshBackupList() {
      const listEl = $('#backup-list')
      const res = await window.dsDesktop.backupList()
      if (!res || !Array.isArray(res)) return
      listEl.innerHTML = ''
      if (!res.length) {
        const empty = document.createElement('div')
        empty.className = 'backup-empty'
        empty.textContent = t('backup_none')
        listEl.appendChild(empty)
        return
      }
      res.slice(0, 20).forEach((b) => {
        const row = document.createElement('div')
        row.className = 'backup-row'
        const label = document.createElement('span')
        label.className = 'backup-name'
        label.textContent = b.ts ? new Date(b.ts).toLocaleString() : b.name
        const restoreBtn = document.createElement('button')
        restoreBtn.className = 'btn ghost small'
        restoreBtn.textContent = t('backup_restore')
        restoreBtn.addEventListener('click', async () => {
          askConfirm(t('backup_restore_confirm'), async () => {
            const r = await window.dsDesktop.backupRestore(b.name)
            if (!r || !r.ok) {
              window.UI.toast(String((r && r.error) || t('err_network')))
              return
            }
            await window.Store.restoreSnapshotData(r.data)
            state.activeId = null
            window.UI.renderChatList()
            renderActive()
            window.UI.toast(t('backup_restored'))
          })
        })
        row.appendChild(label)
        row.appendChild(restoreBtn)
        listEl.appendChild(row)
      })
    }

    $('#backup-now-btn').addEventListener('click', async () => {
      const r = await window.dsDesktop.backupCreate()
      window.UI.toast(r && r.ok ? t('backup_created') : t('backup_failed'))
      refreshBackupList()
    })
    $('#backup-open-btn').addEventListener('click', () => window.dsDesktop.backupOpenFolder())

    // 设置 tabs 切换到数据页时刷新备份列表
    $$tabs('.settings-tabs .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'data') refreshBackupList()
      })
    })

    // 点击外部关闭弹层
    document.addEventListener('click', (e) => {
      if (e.target.closest('.popover') || e.target.closest('#model-select') || e.target.closest('#params-btn')) return
      window.UI.closePopovers()
    })

    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        window.UI.closePopovers()
        $('#settings-modal').hidden = true
        $('#rename-modal').hidden = true
        $('#persona-modal').hidden = true
        $('#folder-modal').hidden = true
        $('#stats-modal').hidden = true
        if (!$('#confirm-modal').hidden) {
          $('#confirm-modal').hidden = true
          confirmCallback = null
        }
        closeMsgSearch()
      }
    })

    // 侧栏宽度拖拽
    setupSidebarResizer()

    // 全局错误提示
    window.addEventListener('error', (e) => {
      console.error('Renderer error:', e.message, e.filename, e.lineno)
    })
  }

  function $$tabs(sel) {
    return Array.from(document.querySelectorAll(sel))
  }

  function setupSidebarResizer() {
    const resizer = $('#sidebar-resizer')
    let dragging = false
    resizer.addEventListener('mousedown', (e) => {
      dragging = true
      e.preventDefault()
    })
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const width = Math.min(Math.max(e.clientX, 200), 420)
      document.documentElement.style.setProperty('--sidebar-width', width + 'px')
    })
    document.addEventListener('mouseup', () => {
      if (!dragging) return
      dragging = false
      const width = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10)
      window.Store.saveSettings({ sidebarWidth: width })
    })
  }

  // ---------- 重命名 / 删除 ----------
  function openRename(id) {
    const conv = window.Store.getConversation(id)
    if (!conv) return
    $('#rename-input').value = conv.title
    $('#rename-modal').hidden = false
    $('#rename-input').dataset.id = id
    $('#rename-input').focus()
    $('#rename-input').select()
  }

  $('#rename-ok').addEventListener('click', async () => {
    const id = $('#rename-input').dataset.id
    const title = $('#rename-input').value.trim()
    if (id && title) {
      await window.Store.updateConversation(id, { title })
      window.UI.renderChatList()
    }
    $('#rename-modal').hidden = true
    focusInput()
  })

  $('#rename-cancel').addEventListener('click', () => {
    $('#rename-modal').hidden = true
    focusInput()
  })
  $('#rename-input').addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') $('#rename-ok').click()
  })

  // ---------- 分组 ----------
  function openFolderModal(id) {
    const conv = window.Store.getConversation(id)
    if (!conv) return
    const datalist = $('#folder-options')
    datalist.innerHTML = window.Store.getFolders().map((f) => `<option value="${window.UI.esc(f)}"></option>`).join('')
    $('#folder-input').value = conv.folder || ''
    $('#folder-input').dataset.id = id
    $('#folder-modal').hidden = false
    $('#folder-input').focus()
    $('#folder-input').select()
  }

  $('#folder-ok').addEventListener('click', async () => {
    const id = $('#folder-input').dataset.id
    if (id) {
      await window.Store.setFolder(id, $('#folder-input').value)
      window.UI.renderChatList()
    }
    $('#folder-modal').hidden = true
    focusInput()
  })

  $('#folder-cancel').addEventListener('click', () => {
    $('#folder-modal').hidden = true
    focusInput()
  })

  $('#folder-input').addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') $('#folder-ok').click()
  })

  function focusInput() {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) {
      $('#chat-input').focus()
    }
  }

  let confirmCallback = null

  function askConfirm(message, cb) {
    $('#confirm-message').textContent = message
    confirmCallback = cb
    $('#confirm-modal').hidden = false
    $('#confirm-ok').focus()
  }

  function deleteConversation(id) {
    const conv = window.Store.getConversation(id)
    if (!conv) return
    askConfirm(t('confirm_delete_message').replace('{title}', conv.title), async () => {
      await window.Store.removeConversation(id)
      if (state.activeId === id) {
        state.activeId = null
        window.UI.renderMessages()
      }
      window.UI.renderChatList()
      focusInput()
    })
  }

  function buildConversationMarkdown(conv) {
    const parts = [`# ${conv.title || ''}`, '', `> ${t('export_model_label')}：${MODEL_LABELS[conv.model] || conv.model}`, '']
    if (conv.systemPrompt) {
      parts.push(`## ${t('export_system_prompt')}`, '', conv.systemPrompt, '')
    }
    for (const m of conv.messages || []) {
      if (m.role === 'user') parts.push(`## ${t('export_me')}`, '', m.content || '', '')
      else if (m.role === 'assistant') {
        if (m.reasoning) parts.push(`### ${t('export_reasoning')}`, '', m.reasoning, '')
        parts.push(`## ${t('export_ai')}`, '', m.content || '', '')
      }
    }
    return parts.join('\n')
  }

  function buildConversationJson(conv) {
    return JSON.stringify(
      {
        title: conv.title,
        model: conv.model,
        systemPrompt: conv.systemPrompt,
        thinking: !!conv.thinking,
        search: !!conv.search,
        params: conv.params,
        messages: (conv.messages || []).map((m) => ({ role: m.role, content: m.content, reasoning: m.reasoning, ts: m.ts }))
      },
      null,
      2
    )
  }

  function escapeExportHtml(s) {
    return window.MD.escapeHtml(String(s == null ? '' : s))
  }

  function buildConversationHtml(conv, markdown) {
    const bodyBlocks = []
    for (const m of conv.messages || []) {
      if (!m.content && !m.reasoning) continue
      let inner = ''
      if (m.role === 'user') {
        inner = `<div class="x-role">${escapeExportHtml(t('export_me'))}</div><div class="x-body user">${window.MD.renderMarkdown(m.content || '')}</div>`
      } else if (m.role === 'assistant') {
        const reasonHtml = m.reasoning
          ? `<details class="x-reason"><summary>${escapeExportHtml(t('export_reasoning'))}</summary><div>${escapeExportHtml(m.reasoning).replace(/\n/g, '<br>')}</div></details>`
          : ''
        inner =
          `<div class="x-role">${escapeExportHtml(MODEL_LABELS[m.model] || MODEL_LABELS[conv.model] || 'DeepSeek')}</div>` +
          reasonHtml +
          `<div class="x-body ai">${window.MD.renderMarkdown(m.content || '')}</div>`
      }
      bodyBlocks.push(`<section class="x-msg x-${m.role}">${inner}</section>`)
    }
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeExportHtml(conv.title || 'conversation')}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 860px; margin: 24px auto; padding: 0 16px; color: #1f2328; line-height: 1.7; background: #fff; }
  h1 { font-size: 22px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; }
  .x-meta { color: #6b7280; font-size: 13px; margin-bottom: 20px; }
  .x-msg { margin: 18px 0; padding: 12px 14px; border-radius: 10px; }
  .x-user { background: #eef4ff; }
  .x-assistant { background: #f6f8fa; }
  .x-role { font-size: 12px; font-weight: 600; color: #4d6bfe; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .04em; }
  .x-reason summary { cursor: pointer; font-size: 12.5px; color: #6b7280; margin-bottom: 6px; }
  .x-reason div { font-size: 12.5px; color: #6b7280; white-space: pre-wrap; background: #fff; border: 1px dashed #d1d5db; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
  pre { background: #0d1117; color: #e6edf3; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
  code { font-family: Consolas, Menlo, monospace; }
  p code, li code { background: #eff1f3; border-radius: 4px; padding: 1px 5px; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 6px 10px; }
  blockquote { border-left: 3px solid #d0d7de; color: #57606a; margin-left: 0; padding-left: 12px; }
  img { max-width: 100%; }
</style>
</head>
<body>
<h1>${escapeExportHtml(conv.title || '')}</h1>
<div class="x-meta">${escapeExportHtml(`${t('export_model_label')}: ${MODEL_LABELS[conv.model] || conv.model}`)}</div>
${bodyBlocks.join('\n')}
</body>
</html>`
  }

  async function exportConversation(id) {
    const conv = window.Store.getConversation(id)
    if (!conv) return
    const markdown = buildConversationMarkdown(conv)
    const contents = {
      md: markdown,
      html: buildConversationHtml(conv, markdown),
      json: buildConversationJson(conv)
    }
    const safeName = (conv.title || 'conversation').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)
    const res = await window.dsDesktop.saveConversation({ contents, defaultName: safeName })
    if (res.ok) {
      window.UI.toast(t('conv_exported'))
      return
    }
    if (res.needPdf && res.filePath) {
      const pdfRes = await window.dsDesktop.exportPdf({ html: contents.html, filePath: res.filePath })
      window.UI.toast(pdfRes.ok ? t('conv_exported') : String(pdfRes.error || t('err_network')))
    }
  }

  function setTrashMode(on) {
    state.trashMode = on
    $('#trash-btn').querySelector('span').textContent = on ? t('trash_back') : t('trash_btn')
    window.UI.renderChatList()
  }

  function resetTrashMode() {
    if (state.trashMode) {
      state.trashMode = false
      $('#trash-btn').querySelector('span').textContent = t('trash_btn')
    }
  }

  async function restoreFromTrash(id) {
    await window.Store.restoreConversation(id)
    window.UI.renderChatList()
  }

  function purgeFromTrash(id) {
    const c = window.Store.getTrash().find((x) => x.id === id)
    if (!c) return
    askConfirm(t('confirm_purge_message').replace('{title}', c.title), async () => {
      await window.Store.purgeConversation(id)
      window.UI.renderChatList()
    })
  }

  $('#confirm-ok').addEventListener('click', async () => {
    $('#confirm-modal').hidden = true
    const cb = confirmCallback
    confirmCallback = null
    if (cb) await cb()
  })

  $('#confirm-cancel').addEventListener('click', () => {
    $('#confirm-modal').hidden = true
    confirmCallback = null
  })

  // 打开设置（供缺 Key 提示跳转）
  window.openSettings = () => {
    window.UI.syncSettingsPanel(window.Store.getSettings())
    $('#settings-modal').hidden = false
    document.querySelector('.settings-tabs .tab-btn[data-tab="api"]').click()
  }

  window.MODEL_LABELS = MODEL_LABELS
  window.renderPromptPresets = renderPromptPresets

  document.addEventListener('DOMContentLoaded', init)
})()