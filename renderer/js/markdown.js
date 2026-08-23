(function () {
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  const IMG_URL_RE =
    /(?<![\w\]"('=])https?:\/\/[^\s<>]+?\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)(?:\?[^\s"'<>)]*)?/gi

  function trimTrailing(url) {
    return url.replace(/[，。！？、；：）)\]]+$/, '')
  }

  function imgHtml(url) {
    const u = escapeHtml(trimTrailing(url))
    const alt = escapeHtml(window.I18N ? window.I18N.t('image_alt') : 'image')
    return `<a href="${u}" target="_blank" rel="noopener" class="img-link"><img src="${u}" alt="${alt}" loading="lazy"></a>`
  }

  function embedImageUrls(text) {
    const codeBlocks = []
    let protectedText = text.replace(/```[\s\S]*?```/g, (m) => {
      codeBlocks.push(m)
      return '\u0001' + (codeBlocks.length - 1) + '\u0001'
    })
    protectedText = protectedText.replace(/`[^`\n]+`/g, (m) => {
      codeBlocks.push(m)
      return '\u0002' + (codeBlocks.length - 1) + '\u0002'
    })
    protectedText = protectedText.replace(IMG_URL_RE, (m) => {
      const url = trimTrailing(m)
      return `![${escapeHtml(window.I18N ? window.I18N.t('image_alt') : 'image')}](${url})`
    })
    protectedText = protectedText.replace(/\u0001(\d+)\u0001/g, (m, i) => codeBlocks[Number(i)])
    protectedText = protectedText.replace(/\u0002(\d+)\u0002/g, (m, i) => codeBlocks[Number(i)])
    return protectedText
  }

  const KEYWORDS = {
    js: /\b(?:const|let|var|function|return|if|else|for|while|do|class|new|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|null|undefined|true|false|switch|case|break|continue|extends|super|static|get|set|yield|delete|void|interface|type|enum|implements|private|public|protected|readonly|namespace|declare)\b/,
    ts: /\b(?:const|let|var|function|return|if|else|for|while|do|class|new|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|null|undefined|true|false|switch|case|break|continue|extends|super|static|get|set|yield|delete|void|interface|type|enum|implements|private|public|protected|readonly|satisfies|as|is|keyof)\b/,
    py: /\b(?:def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|pass|break|continue|lambda|yield|raise|global|nonlocal|del|assert|and|or|not|is|in|None|True|False|async|await|self|match|case)\b/,
    bash: /\b(?:if|then|else|elif|fi|for|while|do|done|function|return|echo|export|local|source|cd|sudo|case|esac|exit)\b/,
    c: /\b(?:int|float|double|char|void|return|if|else|for|while|do|switch|case|break|continue|struct|union|typedef|enum|const|static|extern|sizeof|unsigned|long|short|unsigned)\b/,
    cpp: /\b(?:int|float|double|char|void|bool|return|if|else|for|while|do|switch|case|break|continue|struct|union|typedef|enum|const|static|extern|sizeof|unsigned|long|short|class|public|private|protected|namespace|using|template|new|delete|this|true|false|nullptr|string|auto)\b/,
    go: /\b(?:package|import|func|return|if|else|for|range|go|defer|select|switch|case|break|continue|default|struct|interface|type|var|const|map|chan|nil|true|false|error|string)\b/,
    rust: /\b(?:fn|let|mut|const|static|if|else|for|while|loop|match|return|use|mod|struct|enum|impl|trait|pub|fn|async|await|move|ref|dyn|self|Self|true|false|Option|Result|Some|None|Ok|Err)\b/,
    java: /\b(?:public|private|protected|class|interface|extends|implements|return|if|else|for|while|do|switch|case|break|continue|new|try|catch|finally|throw|throws|import|package|static|final|void|int|long|double|float|boolean|char|byte|short|String|this|super|null|true|false|enum|abstract|synchronized)\b/,
    json: null,
    html: /\b(?:html|head|body|div|span|p|a|img|script|style|link|meta|title|button|input|form|table|tr|td|th|ul|ol|li|h1|h2|h3|h4|h5|h6|section|header|footer|main|aside|nav|iframe)\b/,
    css: /\b(?:color|background|background-color|border|margin|padding|display|position|top|right|bottom|left|width|height|font|font-size|font-family|font-weight|line-height|text-align|text-decoration|overflow|flex|grid|gap|align-items|justify-content|transform|transition|animation|opacity|z-index|box-shadow|border-radius|content|visibility)\b/,
    sql: /\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|NULL|PRIMARY|KEY|FOREIGN|REFERENCES|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|END|UNION|ALL|EXISTS|IN|LIKE|BETWEEN|IS|ASC|DESC)\b/i
  }

  function normalizeLang(lang) {
    if (!lang) return ''
    const l = lang.toLowerCase().trim()
    if (['js', 'javascript', 'node', 'jsx', 'mjs', 'cjs'].includes(l)) return 'js'
    if (['ts', 'typescript', 'tsx'].includes(l)) return 'ts'
    if (['py', 'python'].includes(l)) return 'py'
    if (['sh', 'shell', 'bash', 'zsh', 'powershell', 'ps1', 'bat', 'cmd'].includes(l)) return 'bash'
    if (['c', 'h'].includes(l)) return 'c'
    if (['cpp', 'c++', 'cc', 'hpp'].includes(l)) return 'cpp'
    if (['go', 'golang'].includes(l)) return 'go'
    if (['rs', 'rust'].includes(l)) return 'rust'
    if (['java'].includes(l)) return 'java'
    if (['json'].includes(l)) return 'json'
    if (['html', 'xml', 'svg', 'vue'].includes(l)) return 'html'
    if (['css', 'scss', 'less'].includes(l)) return 'css'
    if (['sql'].includes(l)) return 'sql'
    return l
  }

  function highlightCode(code, lang) {
    const l = normalizeLang(lang)
    if (window.hljs) {
      try {
        if (l && l !== 'text' && window.hljs.getLanguage(l)) {
          return window.hljs.highlight(code, { language: l, ignoreIllegals: true }).value
        }
        if (l === 'text' || l === 'plaintext') return escapeHtml(code)
        const auto = window.hljs.highlightAuto(code)
        if (auto && auto.value && auto.relevance > 0) return auto.value
      } catch {
        /* fall through to legacy highlighter */
      }
    }
    const esc = escapeHtml(code)
    if (!l || !KEYWORDS[l]) return esc

    let tok = ''
    if (l === 'json') {
      tok = esc.replace(
        /("(?:[^"\\]|\\.)*")(\s*:)?|(\b-?\d[\d.eE+-]*\b)|\b(true|false|null)\b/g,
        (m, str, colon, num, kw) => {
          if (str) return colon ? `<span class="tok-s">${str}</span>${colon}` : `<span class="tok-s">${str}</span>`
          if (num) return `<span class="tok-n">${num}</span>`
          if (kw) return `<span class="tok-k">${kw}</span>`
          return m
        }
      )
      return tok
    }

    const commentPattern =
      l === 'py' || l === 'bash'
        ? /(#[^\n]*)/g
        : l === 'html'
        ? /(<!--[\s\S]*?-->)/g
        : /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g

    const stringPattern = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g
    const numberPattern = /\b(-?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g
    const wordPattern = /\b[A-Za-z_$][\w$]*\b/g
    const opPattern = /([{}()\[\];,.:=+\-*/<>!?&|%~^]+)/g
    const kwRe = KEYWORDS[l]

    let result = ''
    let i = 0
    const matches = []
    let m

    while ((m = commentPattern.exec(esc))) matches.push([m.index, m.index + m[0].length, 'c', m[0]])
    commentPattern.lastIndex = 0
    while ((m = stringPattern.exec(esc))) matches.push([m.index, m.index + m[0].length, 's', m[0]])
    stringPattern.lastIndex = 0
    while ((m = numberPattern.exec(esc))) matches.push([m.index, m.index + m[0].length, 'n', m[0]])
    numberPattern.lastIndex = 0
    while ((m = wordPattern.exec(esc))) matches.push([m.index, m.index + m[0].length, 'w', m[0]])
    wordPattern.lastIndex = 0
    while ((m = opPattern.exec(esc))) matches.push([m.index, m.index + m[0].length, 'o', m[0]])
    opPattern.lastIndex = 0

    matches.sort((a, b) => a[0] - b[0] || b[1] - a[1])

    const merged = []
    for (const tok2 of matches) {
      const last = merged[merged.length - 1]
      if (last && tok2[0] < last[1]) {
        if (tok2[1] > last[1]) {
          const prevCls = last[2] === 'c' ? 'tok-c' : last[2] === 's' ? 'tok-s' : last[2] === 'n' ? 'tok-n' : 'tok-w'
          const tail = esc.slice(last[1], tok2[1])
          last[3] = last[3] + tail
          last[1] = tok2[1]
        }
        continue
      }
      merged.push([tok2[0], tok2[1], tok2[2], tok2[3]])
    }

    for (const [start, end, cls, raw] of merged) {
      if (start < i) continue
      result += esc.slice(i, start)
      if (cls === 'w') {
        const kw = kwRe && raw.match(kwRe)
        const up = raw[0] === raw[0].toUpperCase() && raw.toLowerCase() !== raw
        result += kw ? `<span class="tok-k">${raw}</span>` : up ? `<span class="tok-f">${raw}</span>` : raw
      } else if (cls === 'c') {
        result += `<span class="tok-c">${raw}</span>`
      } else if (cls === 's') {
        result += `<span class="tok-s">${raw}</span>`
      } else if (cls === 'n') {
        result += `<span class="tok-n">${raw}</span>`
      } else {
        result += `<span class="tok-o">${raw}</span>`
      }
      i = end
    }
    result += esc.slice(i)
    return result
  }

  function copyText(text) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* noop */
    }
    document.body.removeChild(ta)
  }

  let renderer = null
  if (window.marked) {
    renderer = new window.marked.Renderer()
    renderer.code = function (code, infostring, escaped) {
      let raw = code
      let lang = infostring || ''
      if (code && typeof code === 'object') {
        raw = code.text || ''
        lang = code.lang || ''
      }
      raw = String(raw || '')
      lang = String(lang || '').trim().split(/\s+/)[0]
      const l = normalizeLang(lang)
      if (l === 'mermaid') {
        return `<div class="mermaid-box"><pre class="mermaid">${escapeHtml(raw)}</pre></div>`
      }
      const html = highlightCode(raw, lang)
      const label = l || 'text'
      const lineCount = raw.split('\n').length
      const gutter = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')
      return `<div class="code-block"><div class="code-head"><span>${escapeHtml(label)}</span><button class="copy-btn" data-copy>复制</button></div><div class="code-body"><div class="ln-gutter"><pre>${gutter}</pre></div><pre><code class="hljs">${html}</code></pre></div></div>`
    }
    renderer.html = function (html) {
      return escapeHtml(String(html || ''))
    }
    renderer.link = function (href, title, text) {
      href = String(href || '')
      let safeHref = ''
      if (/^(https?:\/\/|\/\/)/i.test(href) || /^(https?|mailto):/i.test(href) || /^#/.test(href)) {
        safeHref = href
      } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        safeHref = href
      }
      const external = /^https?:\/\//i.test(safeHref)
      const t = title ? ` title="${escapeHtml(title)}"` : ''
      if (!safeHref) return text
      if (external) {
        return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener"${t}>${text}</a>`
      }
      return `<a href="${escapeHtml(safeHref)}"${t}>${text}</a>`
    }
    renderer.image = function (href, title, text) {
      if (!/^(https?|data|blob|file):/i.test(href)) return text
      const url = escapeHtml(href)
      const alt = escapeHtml(text || (window.I18N ? window.I18N.t('image_alt') : 'image'))
      const t = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${url}" target="_blank" rel="noopener" class="img-link"><img src="${url}" alt="${alt}"${t} loading="lazy"></a>`
    }
    window.marked.setOptions({
      renderer,
      gfm: true,
      breaks: true
    })
  }

  function mathHtml(item) {
    if (!item) return ''
    if (!window.katex) return '<code>' + escapeHtml(item.math) + '</code>'
    try {
      return window.katex.renderToString(item.math, { displayMode: item.display, throwOnError: false })
    } catch {
      return '<code>' + escapeHtml(item.math) + '</code>'
    }
  }

  function renderMarkdown(text) {
    if (window.marked) {
      try {
        const embedded = embedImageUrls(text)
        const codes = []
        let t = embedded.replace(/```[\s\S]*?```/g, (m) => {
          codes.push(m)
          return '\u0004' + (codes.length - 1) + '\u0004'
        })
        t = t.replace(/`[^`\n]+`/g, (m) => {
          codes.push(m)
          return '\u0005' + (codes.length - 1) + '\u0005'
        })
        const mathItems = []
        t = t.replace(/\$\$([\s\S]+?)\$\$/g, (m, math) => {
          mathItems.push({ math: math.trim(), display: true })
          return '\u0006' + (mathItems.length - 1) + '\u0006'
        })
        t = t.replace(/\$([^$\n ](?:[^$\n]*[^$\n ])?)\$/g, (m, math) => {
          mathItems.push({ math: math.trim(), display: false })
          return '\u0007' + (mathItems.length - 1) + '\u0007'
        })
        t = t.replace(/\u0004(\d+)\u0004/g, (m, i) => codes[Number(i)])
        t = t.replace(/\u0005(\d+)\u0005/g, (m, i) => codes[Number(i)])
        let html = window.marked.parse(t)
        html = html.replace(/\u0006(\d+)\u0006/g, (m, i) => mathHtml(mathItems[Number(i)]))
        html = html.replace(/\u0007(\d+)\u0007/g, (m, i) => mathHtml(mathItems[Number(i)]))
        return html
      } catch {
        return escapeHtml(text).replace(/\n/g, '<br>')
      }
    }
    return escapeHtml(text).replace(/\n/g, '<br>')
  }

  const MD_IMG_SYNTAX_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g

  function renderPlain(text) {
    const placeholders = []
    const protectedText = text
      .replace(MD_IMG_SYNTAX_RE, (m, url) => {
        placeholders.push(url)
        return '\u0000' + (placeholders.length - 1) + '\u0000'
      })
      .replace(IMG_URL_RE, (m) => {
        placeholders.push(m)
        return '\u0000' + (placeholders.length - 1) + '\u0000'
      })
    let html = escapeHtml(protectedText).replace(/\n/g, '<br>')
    html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => imgHtml(placeholders[Number(i)]))
    return html
  }

  async function renderDiagrams(root) {
    if (!window.mermaid) return
    const nodes = Array.from((root || document).querySelectorAll('.mermaid'))
    for (const n of nodes) {
      if (n.dataset.rendered) continue
      const code = (n.textContent || '').trim()
      n.dataset.rendered = '1'
      if (!code) continue
      try {
        const id = 'mmd' + Math.random().toString(36).slice(2, 10)
        const { svg } = await window.mermaid.render(id, code)
        n.innerHTML = svg
      } catch {
        /* leave raw text */
      }
    }
  }

  window.MD = { renderMarkdown, renderPlain, escapeHtml, highlightCode, copyText, renderDiagrams }
})()