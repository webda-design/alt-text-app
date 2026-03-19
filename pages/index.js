import { useState, useRef } from 'react'
import Head from 'next/head'

const IMAGE_TYPES = ['円グラフ', '棒グラフ', '折れ線グラフ', 'フローチャート', '図解', '人物写真', '風景写真', '商品写真', 'ロゴ', 'バナー', '装飾', 'その他']

export default function Home() {
  const [imgCount, setImgCount] = useState(1)
  const [detectInfo, setDetectInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [regenLoading, setRegenLoading] = useState({})
  const [results, setResults] = useState([])
  const [imgDataCache, setImgDataCache] = useState([])
  const [allTextCache, setAllTextCache] = useState('')
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const pasteRef = useRef(null)

  function analyzeContent() {
    if (!pasteRef.current) return { imgData: [], allText: '' }
    const html = pasteRef.current.innerHTML || ''
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()

    const tokens = []
    function walk(node) {
      if (node.nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, ' ').trim()
        if (t.length > 1) tokens.push({ type: 'text', value: t })
      } else if (node.nodeName === 'IMG') {
        const src = node.getAttribute('src') || ''
        const isBlob = src.startsWith('blob:')
        const isData = src.startsWith('data:')
        tokens.push({
          type: 'img',
          src: (isBlob || isData) ? '' : src,
          rawSrc: src,
          alt: node.getAttribute('alt') || '',
          title: node.getAttribute('title') || '',
          filename: (!isBlob && !isData && src) ? src.split('/').pop().split('?')[0] : ''
        })
      } else {
        node.childNodes.forEach(walk)
      }
    }
    walk(doc.body)

    const imgData = []
    tokens.forEach((tok, i) => {
      if (tok.type !== 'img') return
      let prev = '', pc = 0
      for (let j = i - 1; j >= 0 && pc < 10; j--) {
        if (tokens[j].type === 'text') { prev = tokens[j].value + ' ' + prev; pc++ }
      }
      let next = '', nc = 0
      for (let j = i + 1; j < tokens.length && nc < 10; j++) {
        if (tokens[j].type === 'text') { next += ' ' + tokens[j].value; nc++ }
      }
      imgData.push({ ...tok, prev: prev.trim().slice(0, 400), next: next.trim().slice(0, 400), caption: '' })
    })

    // figcaption
    doc.querySelectorAll('figure').forEach(fig => {
      const img = fig.querySelector('img')
      const cap = fig.querySelector('figcaption')
      if (img && cap) {
        const src = img.getAttribute('src') || ''
        const found = imgData.find(d => d.src === src)
        if (found) found.caption = cap.textContent.trim()
      }
    })

    // data:URL画像のbase64抽出
    doc.querySelectorAll('img').forEach((imgEl, idx) => {
      const src = imgEl.getAttribute('src') || ''
      if (src.startsWith('data:')) {
        const match = src.match(/^data:(image\/[^;]+);base64,(.+)$/)
        if (match && imgData[idx]) {
          imgData[idx].base64 = match[2].slice(0, 1500000)
          imgData[idx].mediaType = match[1]
        }
      }
    })

    // インラインSVG要素を画像として取得
    let svgIdx = 0
    doc.querySelectorAll('svg').forEach(svgEl => {
      try {
        const svgStr = new XMLSerializer().serializeToString(svgEl)
        const b64 = btoa(unescape(encodeURIComponent(svgStr)))
        if (imgData[svgIdx]) {
          imgData[svgIdx].base64 = b64
          imgData[svgIdx].mediaType = 'image/svg+xml'
        }
        svgIdx++
      } catch (e) {}
    })

    return { imgData, allText: text.slice(0, 4000) }
  }

  function handleInput() {
    setTimeout(() => {
      const { imgData, allText } = analyzeContent()
      if (allText.length > 0 || imgData.length > 0) {
        setDetectInfo({ text: allText.length, imgs: imgData.length })
        if (imgData.length > 0) setImgCount(imgData.length)
      } else {
        setDetectInfo(null)
      }
    }, 150)
  }

  async function fetchImagesBase64(imgData) {
    return Promise.all(imgData.map(async (img) => {
      if (img.base64) return img
      const url = img.src || img.rawSrc
      if (!url || url.startsWith('blob:')) return img
      try {
        const r = await fetch('/api/fetch-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        })
        if (r.ok) {
          const d = await r.json()
          return { ...img, base64: d.base64, mediaType: d.mediaType }
        }
      } catch (e) {}
      return img
    }))
  }

  async function generate() {
    setError('')
    setResults([])
    const { imgData, allText } = analyzeContent()
    const useCount = imgData.length > 0 ? imgData.length : imgCount
    if (!allText && imgData.length === 0) {
      setError('コンテンツが空です。記事をコピー＆ペーストしてください。')
      return
    }
    setLoading(true)
    const imgDataWithB64 = await fetchImagesBase64(imgData)
    setImgDataCache(imgDataWithB64)
    setAllTextCache(allText)
    try {
      const resp = await fetch('/api/generate-alt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allText, imgData: imgDataWithB64, manualCount: useCount })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
      setResults(data.results || [])
    } catch (e) {
      setError('生成に失敗しました：' + e.message)
    }
    setLoading(false)
  }

  function handleTypeChange(idx, newType) {
    setResults(prev => prev.map((r, i) => i === idx
      ? { ...r, imageType: newType, isDecorative: newType === '装飾' }
      : r
    ))
  }

  async function regenerateOne(idx) {
    const img = imgDataCache[idx]
    if (!img) return
    setRegenLoading(prev => ({ ...prev, [idx]: true }))
    const overrideType = results[idx]?.imageType || ''
    try {
      const resp = await fetch('/api/generate-alt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allText: allTextCache, imgData: [img], manualCount: 1, overrideType })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      if (data.results?.[0]) {
        setResults(prev => prev.map((r, i) => i === idx
          ? { ...data.results[0], index: r.index, filename: r.filename, imageType: overrideType || data.results[0].imageType }
          : r
        ))
      }
    } catch (e) { console.error(e) }
    setRegenLoading(prev => ({ ...prev, [idx]: false }))
  }

  function copyAlt(id, value) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1600)
    })
  }

  return (
    <>
      <Head>
        <title>画像 alt テキスト生成 | Strange Brain</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div style={s.page}>
        <header style={s.header}>
          <div style={s.headerInner}>
            <div style={s.logo}>
              <div style={s.logoMark}>SB</div>
              <span style={s.logoText}>画像 alt テキスト生成</span>
            </div>
            <span style={s.headerBadge}>JIS X 8341-3 / WCAG 2.0 準拠</span>
          </div>
        </header>

        <main style={s.main}>
          <p style={s.pageDesc}>WordPressの公開済み記事をそのままコピー＆ペーストして、アクセシビリティに配慮したaltテキストを自動生成します。</p>

          <div style={s.card}>
            <div style={s.howTo}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>ブラウザで公開済み記事を開き、記事の本文部分をマウスで選択してコピー。下の欄にそのままペーストしてください。画像も一緒にコピーされます。</span>
            </div>

            <label style={s.fieldLabel}>記事コンテンツ</label>
            <div
              ref={pasteRef}
              contentEditable
              suppressContentEditableWarning
              style={s.pasteArea}
              data-ph="ここに記事の本文と画像をコピー＆ペーストしてください…"
              onInput={handleInput}
              onPaste={handleInput}
            />

            {detectInfo && (
              <div style={s.detectBadge}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                テキスト {detectInfo.text} 文字 ／ 画像 {detectInfo.imgs} 枚 を検出
              </div>
            )}

            <div style={s.countRow}>
              <label style={s.countLabel}>記事内の画像枚数</label>
              <input type="number" min="1" max="50" value={imgCount}
                onChange={e => setImgCount(parseInt(e.target.value) || 1)}
                style={s.numInput} />
              <span style={s.countHint}>画像が自動検出されない場合に手動指定</span>
            </div>

            <button onClick={generate} disabled={loading}
              style={{ ...s.genBtn, ...(loading ? s.genBtnLoading : {}) }}>
              {loading
                ? <><span style={s.spinner} />生成中…</>
                : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>altテキストを生成</>
              }
            </button>

            {error && (
              <div style={s.errorBox}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                {error}
              </div>
            )}
          </div>

          {results.length > 0 && (
            <div>
              <div style={s.resultsHeader}>
                <span style={s.resultsCount}>{results.length} 枚分のaltテキストを生成しました</span>
              </div>
              {results.map((r, i) => {
                const img = imgDataCache[i] || {}
                const validSrc = img.src && !img.src.startsWith('blob:') ? img.src : ''
                const ctx = [img.prev ? '…' + img.prev : '', '【画像】', img.next ? img.next + '…' : ''].filter(Boolean).join(' ')
                const isRegening = regenLoading[i]

                return (
                  <div key={i} style={s.resultCard}>
                    <div style={s.rcHeader}>
                      {validSrc
                        ? <img src={validSrc} alt="" style={s.thumb} onError={e => e.target.style.display = 'none'} />
                        : <div style={s.thumbPh}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>
                      }
                      <div style={s.rcMeta}>
                        <div style={s.rcNumRow}>
                          <span style={s.rcNum}>{r.index || i + 1}</span>
                          {(r.filename || img.filename) && (
                            <span style={s.rcFilename}>{r.filename || img.filename}</span>
                          )}
                        </div>
                        <div style={s.typeRow}>
                          <select
                            value={r.imageType || 'その他'}
                            onChange={e => handleTypeChange(i, e.target.value)}
                            style={s.typeSelect}
                          >
                            {IMAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <button
                            onClick={() => regenerateOne(i)}
                            disabled={isRegening}
                            style={{ ...s.regenBtn, ...(isRegening ? s.regenBtnLoading : {}) }}
                          >
                            {isRegening
                              ? <><span style={s.spinnerSm} />再生成中</>
                              : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>このカテゴリで再生成</>
                            }
                          </button>
                        </div>
                      </div>
                    </div>

                    {ctx.length > 5 && <div style={s.rcContext}>{ctx}</div>}

                    {(r.alts || []).map((alt, ai) => {
                      const id = `${i}-${ai}`
                      const isCopied = copiedId === id
                      return (
                        <div key={ai} style={s.altRow}>
                          <span style={s.altLabel}>{ai === 0 ? 'A' : 'B'}</span>
                          <input defaultValue={alt} style={s.altInput} id={`alt-${id}`} />
                          <button
                            onClick={() => { const el = document.getElementById(`alt-${id}`); copyAlt(id, el ? el.value : alt) }}
                            style={{ ...s.copyBtn, ...(isCopied ? s.copyBtnDone : {}) }}
                          >
                            {isCopied
                              ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>完了</>
                              : 'コピー'
                            }
                          </button>
                        </div>
                      )
                    })}

                    {r.reason && <div style={s.rcReason}>{r.reason}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', 'Hiragino Sans', 'Noto Sans JP', sans-serif; background: #f8fafc; color: #1e293b; }
        [contenteditable]:empty:before { content: attr(data-ph); color: #94a3b8; pointer-events: none; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}

const s = {
  page: { minHeight: '100vh', background: '#f8fafc' },
  header: { background: '#fff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 },
  headerInner: { maxWidth: 800, margin: '0 auto', padding: '0 2rem', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: { width: 28, height: 28, borderRadius: 7, background: '#2b70ef', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 },
  logoText: { fontSize: 15, fontWeight: 600, color: '#0f172a' },
  headerBadge: { fontSize: 11, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 20, padding: '3px 10px', fontWeight: 500 },
  main: { maxWidth: 800, margin: '0 auto', padding: '2rem 2rem 4rem' },
  pageDesc: { fontSize: 14, color: '#64748b', lineHeight: 1.65, marginBottom: '1.5rem' },
  card: { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '1.5rem', marginBottom: '1.5rem' },
  howTo: { display: 'flex', gap: 8, background: '#eff6ff', borderRadius: 8, padding: '10px 14px', marginBottom: '1.25rem', fontSize: 13, color: '#1d4ed8', lineHeight: 1.6, alignItems: 'flex-start' },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 },
  pasteArea: { width: '100%', minHeight: 320, maxHeight: 560, overflowY: 'auto', border: '1.5px dashed #cbd5e1', borderRadius: 10, padding: '16px 18px', fontSize: 14, color: '#1e293b', background: '#f8fafc', outline: 'none', lineHeight: 1.75, cursor: 'text' },
  detectBadge: { display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, fontSize: 12, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, padding: '4px 10px', fontWeight: 500 },
  countRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  countLabel: { fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' },
  numInput: { width: 64, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', color: '#1e293b', background: '#fff', outline: 'none', textAlign: 'center' },
  countHint: { fontSize: 12, color: '#94a3b8' },
  genBtn: { marginTop: 16, padding: '10px 24px', background: '#2b70ef', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 },
  genBtnLoading: { background: '#93b5f5', cursor: 'not-allowed' },
  spinner: { display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.65s linear infinite', flexShrink: 0 },
  spinnerSm: { display: 'inline-block', width: 11, height: 11, border: '2px solid rgba(0,0,0,0.12)', borderTopColor: '#475569', borderRadius: '50%', animation: 'spin 0.65s linear infinite', flexShrink: 0 },
  errorBox: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' },
  resultsHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  resultsCount: { fontSize: 13, fontWeight: 500, color: '#475569' },
  resultCard: { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '16px 18px', marginBottom: 10 },
  rcHeader: { display: 'flex', gap: 12, marginBottom: 10 },
  thumb: { width: 80, height: 56, objectFit: 'cover', borderRadius: 7, border: '1px solid #e2e8f0', flexShrink: 0 },
  thumbPh: { width: 80, height: 56, borderRadius: 7, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rcMeta: { flex: 1, minWidth: 0 },
  rcNumRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 },
  rcNum: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, fontSize: 11, fontWeight: 600, color: '#fff', background: '#2b70ef', borderRadius: '50%', flexShrink: 0 },
  rcFilename: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  typeRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typeSelect: { fontSize: 12, padding: '4px 26px 4px 8px', border: '1px solid #cbd5e1', borderRadius: 7, background: "#f8fafc url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E\") no-repeat right 8px center", color: '#475569', outline: 'none', fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' },
  regenBtn: { fontSize: 12, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 7, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' },
  regenBtnLoading: { opacity: 0.6, cursor: 'not-allowed' },
  rcContext: { fontSize: 12, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.6 },
  altRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  altLabel: { fontSize: 11, color: '#94a3b8', width: 18, flexShrink: 0, textAlign: 'center', fontWeight: 700 },
  altInput: { flex: 1, fontSize: 14, padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontFamily: 'inherit', color: '#1e293b', background: '#f8fafc', outline: 'none' },
  copyBtn: { padding: '8px 14px', fontSize: 12, fontWeight: 500, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 },
  copyBtnDone: { color: '#059669', borderColor: '#6ee7b7', background: '#ecfdf5' },
  rcReason: { fontSize: 11, color: '#94a3b8', marginTop: 6 },
}
