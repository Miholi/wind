(function () {
  'use strict'

  // 内置平台：仅 DeepSeek，页面加载后自动接入（历史多平台侧栏已移除）
  const PLATFORMS = [
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', img: 'img/platform-1.png' }
  ]

  const $ = (sel) => document.querySelector(sel)
  const loadingEl = $('#webview-loading')
  const loadingAvatarEl = $('#loading-avatar')
  const loadingTextEl = $('#loading-text')

  function showLoading(p) {
    if (!loadingEl) return
    if (p) {
      if (loadingTextEl) loadingTextEl.textContent = '正在连接 ' + p.name + '…'
      if (loadingAvatarEl) {
        loadingAvatarEl.src = p.img || 'img/platform-1.png'
        loadingAvatarEl.style.display = ''
      }
    }
    loadingEl.classList.remove('is-hidden')
  }

  function hideLoading() {
    if (loadingEl) loadingEl.classList.add('is-hidden')
  }

  function loadPlatform(p) {
    showLoading(p)
    window.dsDesktop.selectPlatform({ id: p.id, url: p.url })
  }

  function init() {
    if (!window.dsDesktop) {
      console.error('dsDesktop bridge missing')
      return
    }
    loadPlatform(PLATFORMS[0])
    if (window.dsDesktop.onLoading) {
      window.dsDesktop.onLoading((loading) => {
        if (loading) showLoading(PLATFORMS[0])
        else hideLoading()
      })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
