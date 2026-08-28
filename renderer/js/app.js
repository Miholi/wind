(function () {
  'use strict'

  const DEFAULT_BRAND = '#9aa3af'

  const PLATFORMS = [
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', color: '#4d6bfe', img: 'img/platform-1.png' }
  ]
  let avatarOverrides = {}
  let currentId = null
  // 裁剪头像弹窗打开期间忽略主进程的 loading 事件并隐藏网页视图，
  // 关闭时按 lastLoadingVal 恢复遮罩最终状态。
  let lastLoadingVal = false

  const $ = (sel) => document.querySelector(sel)
  const listEl = $('#platform-list')
  const loadingEl = $('#webview-loading')

  function anyBlockingModal() {
    const cropM = document.getElementById('crop-modal')
    return !!(cropM && !cropM.hidden)
  }

  function syncOverlays() {
    if (loadingEl) {
      if (anyBlockingModal()) loadingEl.classList.add('is-hidden')
      else loadingEl.classList.toggle('is-hidden', !lastLoadingVal)
    }
    if (window.dsDesktop) window.dsDesktop.setViewVisible(!anyBlockingModal())
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  /* ============ 轻量 toast 提示（保存失败等） ============ */

  let toastTimer = null
  function showToast(msg, ms) {
    let el = document.getElementById('toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'toast'
      document.body.appendChild(el)
    }
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      el.classList.remove('show')
    }, ms || 2600)
  }

  async function persistAvatar(id, img) {
    try {
      const res = await window.dsDesktop.setAvatar(id, img)
      if (!res || res.ok !== true) throw new Error('save failed')
      return true
    } catch {
      showToast('头像保存失败，重启后将丢失本次更改')
      return false
    }
  }

  /* ============ 头像裁剪弹窗 ============ */

  const CROP_OUT = 256 // 导出头像边长（px）

  // 打开裁剪弹窗：拖动定位 + 滚轮/滑块缩放，确定后把可视区域导出为
  // 256×256 PNG dataURL；取消（按钮 / 点遮罩 / Esc）返回 null。
  // 结构缺失时兜底返回原图，保证换头像功能不因裁剪层异常而中断。
  function openCropModal(src) {
    return new Promise((resolve) => {
      const modal = $('#crop-modal')
      const stage = $('#crop-stage')
      const img = $('#crop-img')
      const zoomSlider = $('#crop-zoom')
      const errEl = $('#crop-error')
      const cancelBtn = $('#crop-cancel')
      const confirmBtn = $('#crop-confirm')
      if (!modal || !stage || !img) return resolve(src)

      let z = 1 // 相对 cover 基准的缩放倍率 [1, 4]
      let ox = 0 // 图片相对舞台左上角的偏移（css px）
      let oy = 0
      let settled = false
      let dragging = false
      let lastX = 0
      let lastY = 0
      let onKey = null

      function stageSize() { return stage.clientWidth || 288 }
      function coverScale() {
        const w = img.naturalWidth || stageSize()
        const h = img.naturalHeight || stageSize()
        return Math.max(stageSize() / w, stageSize() / h)
      }
      function currentScale() { return coverScale() * z }

      function layout() {
        const S = stageSize()
        const sc = coverScale() * z
        const dw = (img.naturalWidth || S) * sc
        const dh = (img.naturalHeight || S) * sc
        // clamp：保证图片始终完整覆盖舞台，不留空隙
        ox = Math.min(0, Math.max(S - dw, ox))
        oy = Math.min(0, Math.max(S - dh, oy))
        img.style.width = dw + 'px'
        img.style.height = dh + 'px'
        img.style.left = ox + 'px'
        img.style.top = oy + 'px'
      }

      // 以 (cx, cy) 为不动点缩放：保持该点下的图像内容位置不变，手感更自然
      function setZoom(nz, cx, cy) {
        nz = Math.min(4, Math.max(1, nz))
        const S = stageSize()
        const fx = typeof cx === 'number' ? cx : S / 2
        const fy = typeof cy === 'number' ? cy : S / 2
        const scOld = currentScale()
        const ix = (fx - ox) / scOld
        const iy = (fy - oy) / scOld
        z = nz
        layout()
        const scNew = currentScale()
        ox = fx - ix * scNew
        oy = fy - iy * scNew
        layout()
        if (zoomSlider) zoomSlider.value = String(z)
      }

      function showErr(msg) {
        if (errEl) {
          errEl.textContent = msg
          errEl.hidden = false
        }
      }
      function hideErr() { if (errEl) errEl.hidden = true }

      function offAll() {
        stage.removeEventListener('pointerdown', onDown)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        stage.removeEventListener('wheel', onWheel)
        if (zoomSlider) zoomSlider.removeEventListener('input', onZoomInput)
        if (cancelBtn) cancelBtn.removeEventListener('click', onCancel)
        if (confirmBtn) confirmBtn.removeEventListener('click', onConfirm)
        modal.removeEventListener('mousedown', onMaskClose)
        window.removeEventListener('keydown', onKey)
        img.removeEventListener('load', onLoad)
        img.removeEventListener('error', onError)
      }

      function finish(val) {
        if (settled) return
        settled = true
        offAll()
        modal.hidden = true
        stage.classList.remove('dragging')
        syncOverlays()
        resolve(val)
      }

      function onCancel() { finish(null) }
      function onMaskClose(e) { if (e.target === modal) finish(null) }
      function onKeyDown(e) { if (e.key === 'Escape') finish(null) }
      function onDown(e) {
        dragging = true
        lastX = e.clientX
        lastY = e.clientY
        stage.classList.add('dragging')
      }
      function onMove(e) {
        if (!dragging) return
        ox += e.clientX - lastX
        oy += e.clientY - lastY
        lastX = e.clientX
        lastY = e.clientY
        layout()
      }
      function onUp() {
        dragging = false
        stage.classList.remove('dragging')
      }
      function onWheel(e) {
        e.preventDefault()
        const r = stage.getBoundingClientRect()
        setZoom(z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
      }
      function onZoomInput() {
        if (zoomSlider) setZoom(parseFloat(zoomSlider.value))
      }
      function onLoad() {
        hideErr()
        layout()
      }
      function onError() { showErr('图片加载失败，请重新选择') }

      function onConfirm() {
        try {
          const S = stageSize()
          const sc = currentScale()
          const cv = document.createElement('canvas')
          cv.width = CROP_OUT
          cv.height = CROP_OUT
          const ctx = cv.getContext('2d')
          ctx.imageSmoothingQuality = 'high'
          // 舞台可视区域按比例映射回原图坐标后居中绘制到 256×256
          ctx.drawImage(img, -ox / sc, -oy / sc, S / sc, S / sc, 0, 0, CROP_OUT, CROP_OUT)
          finish(cv.toDataURL('image/png'))
        } catch (err) {
          console.error('[aiweb] 裁剪导出失败:', err && err.message)
          showErr('导出失败，请重试或更换图片')
        }
      }

      // 绑定一次性监听（每次打开重建，关闭统一解除）
      stage.addEventListener('pointerdown', onDown)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      stage.addEventListener('wheel', onWheel, { passive: false })
      if (zoomSlider) zoomSlider.addEventListener('input', onZoomInput)
      if (cancelBtn) cancelBtn.addEventListener('click', onCancel)
      if (confirmBtn) confirmBtn.addEventListener('click', onConfirm)
      modal.addEventListener('mousedown', onMaskClose)
      onKey = onKeyDown
      window.addEventListener('keydown', onKey)
      img.addEventListener('load', onLoad)
      img.addEventListener('error', onError)

      // 重置状态并打开
      hideErr()
      z = 1
      ox = 0
      oy = 0
      if (zoomSlider) zoomSlider.value = '1'
      img.style.width = ''
      img.style.height = ''
      modal.hidden = false
      syncOverlays()
      img.src = src
      // 图片命中缓存时 load 事件可能已错过，此处补排一次
      if (img.complete && img.naturalWidth) layout()
      if (confirmBtn) confirmBtn.focus()
    })
  }

  /* ============ 平台列表渲染 ============ */

  function effectiveImg(p) {
    if (avatarOverrides[p.id]) return avatarOverrides[p.id]
    return p.img || ''
  }

  function avatar(p) {
    const src = effectiveImg(p)
    if (src) {
      return '<img class="plat-avatar" src="' + escapeHtml(src) + '" alt="' + escapeHtml(p.name) + '">'
    }
    const ch = (p.name || '?').trim().charAt(0).toUpperCase()
    return '<span class="plat-avatar plat-avatar-text" style="background:' + DEFAULT_BRAND + '">' + escapeHtml(ch) + '</span>'
  }

  function allPlatforms() {
    return PLATFORMS
  }

  function renderSidebar() {
    listEl.innerHTML = ''
    allPlatforms().forEach((p) => {
      const item = document.createElement('div')
      item.className = 'plat-item' + (p.id === currentId ? ' active' : '')
      item.dataset.id = p.id
      // 无品牌色时给默认色，保证选中条（var(--brand)）始终有有效值
      item.style.setProperty('--brand', p.color || DEFAULT_BRAND)
      item.innerHTML = avatar(p) + '<span class="plat-label">' + escapeHtml(p.name) + '</span>'
      item.addEventListener('click', () => loadPlatform(p.id))
      listEl.appendChild(item)

      const edit = document.createElement('span')
      edit.className = 'plat-edit'
      edit.textContent = '✎'
      edit.title = '更换头像'
      edit.addEventListener('click', (e) => {
        e.stopPropagation()
        changeAvatar(p.id)
      })
      item.appendChild(edit)
    })
  }

  function loadPlatform(id) {
    const p = allPlatforms().find((x) => x.id === id)
    if (!p) return
    currentId = id
    document.querySelectorAll('.plat-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === id)
    })
    if (loadingEl) {
      loadingEl.classList.remove('is-hidden')
      const av = loadingEl.querySelector('.loading-avatar')
      if (av) {
        const src = effectiveImg(p)
        if (src) {
          av.src = src
          av.style.display = ''
        } else {
          av.style.display = 'none'
        }
      }
    }
    window.dsDesktop.selectPlatform({ id: p.id, url: p.url })
  }

  async function changeAvatar(id) {
    const src = await window.dsDesktop.chooseImage()
    if (!src) return
    // 选图后进入裁剪，用户自行决定取哪一块作为头像
    const cropped = await openCropModal(src)
    if (!cropped) return
    avatarOverrides[id] = cropped
    await persistAvatar(id, cropped)
    renderSidebar()
    if (id === currentId) {
      const av = loadingEl && loadingEl.querySelector('.loading-avatar')
      if (av) {
        av.src = cropped
        av.style.display = ''
      }
    }
  }

  function init() {
    if (!window.dsDesktop) {
      console.error('dsDesktop bridge missing')
      return
    }
    const avatarsReady = window.dsDesktop.getAvatars().then((map) => {
      avatarOverrides = map && typeof map === 'object' ? map : {}
    })
    avatarsReady.then(() => {
      renderSidebar()
      loadPlatform(PLATFORMS[0].id)
    }).catch((err) => {
      console.error('初始化失败:', err && err.message)
      showToast('应用初始化失败，请刷新页面重试', 5000)
      // 降级：即使初始化失败也显示默认平台
      renderSidebar()
      if (PLATFORMS && PLATFORMS[0]) loadPlatform(PLATFORMS[0].id)
    })
    if (window.dsDesktop.onLoading) {
      window.dsDesktop.onLoading((loading) => {
        lastLoadingVal = !!loading
        if (!anyBlockingModal() && loadingEl) {
          if (loading) loadingEl.classList.remove('is-hidden')
          else loadingEl.classList.add('is-hidden')
        }
      })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
