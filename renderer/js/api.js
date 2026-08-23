(function () {
  let requestSeq = 0
  let currentId = null
  const listeners = new Map()

  window.dsDesktop.onChatEvent((data) => {
    const cb = listeners.get(data.requestId)
    if (cb) cb(data)
  })

  const Api = {
    get currentId() {
      return currentId
    },

    async start(payload) {
      const id = 'req_' + (++requestSeq) + '_' + Date.now().toString(36)
      currentId = id
      const creds = window.Store.activeApiCreds()
      const apiKey = creds.apiKey || ''
      const baseUrl = (creds.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')

      if (!apiKey) {
        return { ok: false, error: 'err_no_key' }
      }

      const resolveDone = new Promise((resolve) => {
        const collect = {
          content: '',
          reasoning: '',
          usage: null,
          done: false,
          error: null,
          aborted: false
        }
        listeners.set(id, (data) => {
          switch (data.type) {
            case 'content':
              collect.content += data.content
              if (payload.onContent) payload.onContent(data.content)
              break
            case 'reasoning':
              collect.reasoning += data.content
              if (payload.onReasoning) payload.onReasoning(data.content)
              break
            case 'search':
              if (payload.onSearch) payload.onSearch(data.status)
              break
            case 'usage':
              collect.usage = data.usage
              if (payload.onUsage) payload.onUsage(data.usage)
              break
            case 'error':
              collect.error = data.error
              collect.done = true
              if (currentId === id) currentId = null
              listeners.delete(id)
              if (payload.onError) payload.onError(data.error)
              resolve(collect)
              break
            case 'aborted':
              collect.aborted = true
              collect.done = true
              if (currentId === id) currentId = null
              listeners.delete(id)
              if (payload.onAbort) payload.onAbort()
              resolve(collect)
              break
            case 'done':
            case 'finish':
              collect.done = true
              break
          }
          if (collect.done) {
            if (currentId === id) currentId = null
            listeners.delete(id)
            resolve(collect)
          }
        })
      })

      await window.dsDesktop.chatStart({
        requestId: id,
        model: payload.model,
        messages: payload.messages,
        params: payload.params,
        search: payload.search,
        apiKey,
        baseUrl
      })

      const result = await resolveDone
      return { ok: !result.error && !result.aborted, ...result }
    },

    abort() {
      if (currentId) {
        const id = currentId
        currentId = null
        window.dsDesktop.chatAbort(id)
        return true
      }
      return false
    }
  }

  window.Api = Api
})()