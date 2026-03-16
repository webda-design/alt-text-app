import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'

export default function Home() {
  const [tab, setTab] = useState('main')
  const [ruleUrls, setRuleUrls] = useState([])
  const [imgCount, setImgCount] = useState(1)
  const [detectInfo, setDetectInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [ruleApplied, setRuleApplied] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const pasteRef = useRef(null)

  // 設定をlocalStorageから読み込み
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('alt_rule_urls') || '[]')
      setRuleUrls(saved.length > 0 ? saved : [{ label: '', url: '' }])
    } catch (e) {
      setRuleUrls([{ label: '', url: '' }])
    }
  }, [])

  function saveSettings() {
    const valid = ruleUrls.filter(u => u.url.trim())
    localStorage.setItem('alt_rule_urls', JSON.stringify(valid))
    setSavedMsg('保存しました')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  function addUrl() {
    setRuleUrls(prev => [...prev, { label: '', url: '' }])
  }

  function removeUrl(i) {
    setRuleUrls(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateUrl(i, field, value) {
    setRuleUrls(prev => prev.map((u, idx) => idx === i ? { ...u, [field]: value } : u))
  }

  // ペースト内容を解析
  function analyzeContent() {
    if (!pasteRef.current) return { imgData: [], allText: '' }
    const html = pasteRef.current.innerHTML || ''
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imgEls = doc.querySelectorAll('img')
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()

    const tokens = []
    function walk(node) {
      if (node.nodeType === 3) {
        const t = node.textContent.replace(/\s+/g, ' ').trim()
        if (t.length > 1) tokens.push({ type: 'text', value: t })
      } else if (node.nodeName === 'IMG') {
        const src = node.getAttribute('src') || ''
        const isBlob = src.startsWith('blob:') || src.startsWith('data:')
        tokens.push({
          type: 'img',
          src: isBlob ? '' : src,
          alt: node.getAttribute('alt') || '',
          title: node.getAttribute('title') || '',
          filename: (!isBlob && src) ? src.split('/').pop().split('?')[0] : ''
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
      for (let j = i - 1; j >= 0 && pc < 3; j--) {
        if (tokens[j].type === 'text') { prev = tokens[j].value + ' ' + prev; pc++ }
      }
      let next = '', nc = 0
      for (let j = i + 1; j < tokens.length && nc < 3; j++) {
        if (tokens[j].type === 'text') { next += ' ' + tokens[j].value; nc++ }
      }
      imgData.push({ ...tok, prev: prev.trim().slice(0, 150), next: next.trim().slice(0, 150) })
    })

    return { imgData, allText: text.slice(0, 2000), imgCount: imgEls.length }
  }

  function handlePasteOrInput() {
    setTimeout(() => {
      const { imgData, allText, imgCount: detected } = analyzeContent()
      if (allText.length > 0 || imgData.length > 0) {
        setDetectInfo({ text: allText.length, imgs: imgData.length })
        if (imgData.length > 0) setImgCount(imgData.length)
      } else {
        setDetectInfo(null)
      }
    }, 150)
  }

  async function generate() {
    setError('')
    setResults([])
    setRuleApplied(false)

    const { imgData, allText } = analyzeContent()
    const useCount = imgData.length > 0 ? imgData.length : imgCount

    if (!allText && imgData.length === 0) {
      setError('コンテンツが空です。記事をコピー＆ペーストしてください。')
      return
    }

    setLoading(true)

    const validUrls = ruleUrls.filter(u => u.url.trim().startsWith('http'))

    try {
      const resp = await fetch('/api/generate-alt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allText, imgData, manualCount: useCount, ruleUrls: validUrls })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
      setResults(data.results || [])
      setRuleApplied(data.ruleApplied)
    } catch (e) {
      setError('生成に失敗しました：' + e.message)
    }

    setLoading(false)
  }

  function copyAlt(id, value) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1600)
    })
  }

  const imgData = results.length > 0 ? analyzeContent().imgData : []

  return (
    <>
      <Head>
        <title>画像 alt テキスト生成</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={s.page}>
        <div style={s.app}>
          {/* ヘッダー */}
          <div style={{ marginBottom: '1.75rem' }}>
            <h1 style={s.h1}>画像 alt テキスト生成</h1>
            <p style={s.sub}>公開済み記事の本文と画像をそのままコピー＆ペーストして、altテキストを自動生成します。</p>
          </div>

          {/* タブ */}
          <div style={s.tabBar}>
            {['main', 'settings'].map((t, i) => (
              <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }} onClick={() => setTab(t)}>
                {['生成', '設定'][i]}
              </button>
            ))}
          </div>

          {/* 生成タブ */}
          {tab === 'main' && (
            <>
              <div style={s.card}>
                <div style={s.howTo}>
                  <strong>使い方：</strong>ブラウザで公開済み記事を開き、記事の本文部分をマウスで選択してコピー。下の欄にそのままペーストしてください。画像も一緒にコピーされます。
                  {ruleUrls.filter(u => u.url).length > 0 && (
                    <span style={{ display: 'block', marginTop: 4, color: '#1a6a3a' }}>
                      ✓ 設定済みのaltルール（{ruleUrls.filter(u => u.url).length}件）を自動参照します
                    </span>
                  )}
                </div>

                <div style={s.fieldLabel}>記事コンテンツ</div>
                <div
                  ref={pasteRef}
                  contentEditable
                  suppressContentEditableWarning
                  style={s.pasteArea}
                  data-ph="ここに記事の本文と画像をコピー＆ペーストしてください…"
                  onInput={handlePasteOrInput}
                  onPaste={handlePasteOrInput}
                />

                {detectInfo && (
                  <div style={s.detectInfo}>
                    検出：テキスト {detectInfo.text} 文字 ／ 画像要素 {detectInfo.imgs} 個
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 13, color: '#6e6e73' }}>記事内の画像枚数：</label>
                  <input
                    type="number" min="1" max="50"
                    value={imgCount}
                    onChange={e => setImgCount(parseInt(e.target.value) || 1)}
                    style={s.numInput}
                  />
                  <span style={{ fontSize: 12, color: '#8e8e93' }}>画像が自動検出されない場合に手動指定</span>
                </div>

                <button onClick={generate} disabled={loading} style={{ ...s.genBtn, ...(loading ? s.genBtnDisabled : {}) }}>
                  {loading ? <><Spinner /> 生成中…</> : 'altテキストを生成'}
                </button>

                {error && <div style={s.err}>{error}</div>}
              </div>

              {results.length > 0 && (
                <div>
                  {ruleApplied && (
                    <div style={{ fontSize: 12, color: '#1a6a3a', marginBottom: 10, padding: '6px 12px', background: '#f0faf2', borderRadius: 8 }}>
                      ✓ 設定のaltルールを参照して生成しました
                    </div>
                  )}
                  {results.map((r, i) => {
                    const img = imgData[i] || {}
                    const validSrc = img.src && !img.src.startsWith('blob:') && !img.src.startsWith('data:') ? img.src : ''
                    const ctx = [img.prev ? '…' + img.prev : '', '【画像】', img.next ? img.next + '…' : ''].filter(Boolean).join(' ')
                    return (
                      <div key={i} style={s.resultCard}>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                          {validSrc
                            ? <img src={validSrc} alt="" style={s.thumb} onError={e => e.target.style.display = 'none'} />
                            : <div style={s.thumbPh}>🖼</div>
                          }
                          <div style={{ flex: 1 }}>
                            <span style={s.rcNum}>{r.index || i + 1}</span>
                            {r.isDecorative && <span style={s.decoBadge}>装飾的</span>}
                            <div style={s.rcFilename}>{r.filename || img.filename || `画像 ${i + 1}`}</div>
                          </div>
                        </div>

                        {ctx.length > 5 && <div style={s.rcContext}>{ctx}</div>}

                        {(r.alts || []).map((alt, ai) => {
                          const id = `${i}-${ai}`
                          const isCopied = copiedId === id
                          return (
                            <div key={ai} style={s.altRow}>
                              <span style={s.altLabel}>{ai === 0 ? 'A' : 'B'}</span>
                              <input
                                defaultValue={alt}
                                style={s.altInput}
                                id={`alt-${id}`}
                              />
                              <button
                                onClick={() => {
                                  const el = document.getElementById(`alt-${id}`)
                                  copyAlt(id, el ? el.value : alt)
                                }}
                                style={{ ...s.copyBtn, ...(isCopied ? s.copyBtnDone : {}) }}
                              >
                                {isCopied ? '完了' : 'コピー'}
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
            </>
          )}

          {/* 設定タブ */}
          {tab === 'settings' && (
            <div style={s.card}>
              <div style={s.fieldLabel}>altルール参照URL</div>
              <p style={{ fontSize: 13, color: '#6e6e73', marginBottom: 14, lineHeight: 1.6 }}>
                登録したURLは生成時に<strong>必ず自動参照</strong>されます。altの書き方ガイドラインや社内ルールページのURLを登録してください。
              </p>

              {ruleUrls.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <input
                    placeholder="ラベル名"
                    value={u.label}
                    onChange={e => updateUrl(i, 'label', e.target.value)}
                    style={{ ...s.urlInput, width: 110, flexShrink: 0 }}
                  />
                  <input
                    placeholder="https://..."
                    value={u.url}
                    onChange={e => updateUrl(i, 'url', e.target.value)}
                    style={{ ...s.urlInput, flex: 1 }}
                  />
                  <button onClick={() => removeUrl(i)} style={s.delBtn}>×</button>
                </div>
              ))}

              <button onClick={addUrl} style={s.addUrlBtn}>＋ URLを追加</button>

              <div style={{ height: 1, background: '#e5e5ea', margin: '1rem 0' }} />

              <button onClick={saveSettings} style={s.saveBtn}>保存する</button>
              {savedMsg && <div style={{ fontSize: 12, color: '#34c759', marginTop: 8 }}>{savedMsg}</div>}
            </div>
          )}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
        [contenteditable]:empty:before { content: attr(data-ph); color: #b0b0b5; pointer-events: none; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
      `}</style>
    </>
  )
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 14, height: 14, flexShrink: 0,
      border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff',
      borderRadius: '50%', animation: 'spin 0.65s linear infinite'
    }} />
  )
}

const s = {
  page: { background: '#f5f5f7', minHeight: '100vh' },
  app: { maxWidth: 740, margin: '0 auto', padding: '2rem 1.25rem 3rem' },
  h1: { fontSize: 22, fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.02em', marginBottom: 5 },
  sub: { fontSize: 14, color: '#6e6e73', lineHeight: 1.55 },
  tabBar: { display: 'inline-flex', background: '#e5e5ea', borderRadius: 9, padding: 2, marginBottom: '1.5rem' },
  tab: { fontSize: 13, fontWeight: 500, padding: '5px 18px', borderRadius: 7, border: 'none', background: 'transparent', color: '#6e6e73', cursor: 'pointer', fontFamily: 'inherit' },
  tabActive: { background: '#fff', color: '#1d1d1f', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  card: { background: '#fff', borderRadius: 14, padding: '1.25rem 1.5rem', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: '#6e6e73', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7 },
  howTo: { background: '#f0f6ff', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#3a5a8a', lineHeight: 1.65 },
  pasteArea: {
    width: '100%', minHeight: 180, maxHeight: 320, overflowY: 'auto',
    border: '1.5px dashed #d2d2d7', borderRadius: 12, padding: '14px 16px',
    fontSize: 14, color: '#1d1d1f', background: '#fafafa', outline: 'none', lineHeight: 1.7,
  },
  detectInfo: { marginTop: 10, fontSize: 12, color: '#6e6e73', background: '#f5f5f7', borderRadius: 8, padding: '7px 12px' },
  numInput: { width: 60, padding: '6px 10px', border: '1px solid #d2d2d7', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', color: '#1d1d1f', background: '#fff', outline: 'none', textAlign: 'center' },
  genBtn: { marginTop: 14, padding: '10px 26px', background: '#0071e3', color: '#fff', border: 'none', borderRadius: 20, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 },
  genBtnDisabled: { background: '#b0c8e8', cursor: 'not-allowed' },
  err: { fontSize: 12, color: '#ff3b30', marginTop: 8, lineHeight: 1.5 },
  resultCard: { background: '#fff', borderRadius: 14, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e5e5ea', marginBottom: 10 },
  thumb: { width: 64, height: 46, objectFit: 'cover', borderRadius: 7, border: '1px solid #e5e5ea', flexShrink: 0 },
  thumbPh: { width: 64, height: 46, borderRadius: 7, background: '#e5e5ea', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 },
  rcNum: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, fontSize: 11, fontWeight: 600, color: '#fff', background: '#0071e3', borderRadius: '50%', marginBottom: 4 },
  decoBadge: { fontSize: 11, background: '#fff3e0', color: '#e65100', borderRadius: 5, padding: '2px 7px', marginLeft: 6 },
  rcFilename: { fontSize: 11, color: '#8e8e93', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 2 },
  rcContext: { fontSize: 12, color: '#6e6e73', background: '#f5f5f7', borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.6 },
  altRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  altLabel: { fontSize: 11, color: '#8e8e93', width: 18, flexShrink: 0, textAlign: 'center', fontWeight: 700 },
  altInput: { flex: 1, fontSize: 14, padding: '8px 12px', border: '1px solid #d2d2d7', borderRadius: 9, fontFamily: 'inherit', color: '#1d1d1f', background: '#f5f5f7', outline: 'none' },
  copyBtn: { padding: '8px 14px', fontSize: 12, fontWeight: 500, border: '1px solid #d2d2d7', borderRadius: 9, background: '#fff', color: '#1d1d1f', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' },
  copyBtnDone: { color: '#34c759', borderColor: '#34c759', background: '#f0faf2' },
  rcReason: { fontSize: 11, color: '#b0b0b5', marginTop: 6 },
  urlInput: { fontSize: 13, padding: '7px 11px', border: '1px solid #d2d2d7', borderRadius: 9, fontFamily: 'inherit', color: '#1d1d1f', background: '#fff', outline: 'none' },
  delBtn: { padding: '0 8px', height: 34, fontSize: 18, border: 'none', background: 'transparent', color: '#8e8e93', cursor: 'pointer', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  addUrlBtn: { width: '100%', padding: 9, border: '1.5px dashed #d2d2d7', borderRadius: 9, background: 'transparent', fontSize: 13, color: '#6e6e73', cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn: { padding: '9px 22px', border: '1px solid #d2d2d7', borderRadius: 20, background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: '#1d1d1f' },
}
