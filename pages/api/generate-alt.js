import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { allText, imgData, manualCount, ruleUrls } = req.body

  if (!allText && (!imgData || imgData.length === 0)) {
    return res.status(400).json({ error: 'コンテンツが空です' })
  }

  const useCount = (imgData && imgData.length > 0) ? imgData.length : (manualCount || 1)

  try {
    // 設定URLを必ず取得してルールを読み込む
    let ruleText = ''
    if (ruleUrls && ruleUrls.length > 0) {
      const ruleResults = await Promise.all(
        ruleUrls.map(async (urlObj) => {
          const url = typeof urlObj === 'string' ? urlObj : urlObj.url
          if (!url || !url.startsWith('http')) return ''
          try {
            const label = typeof urlObj === 'object' && urlObj.label ? urlObj.label : ''
            const ruleRes = await client.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 600,
              messages: [{
                role: 'user',
                content: `次のURLのページにある画像altテキストのルール・ガイドラインを日本語で要点のみ箇条書きにしてください（150文字以内）。URL: ${url}`
              }],
              tools: [{ type: 'web_search_20250305', name: 'web_search' }]
            })
            const text = ruleRes.content.filter(c => c.type === 'text').map(c => c.text).join('')
            return label ? `【${label}】\n${text}` : text
          } catch (e) {
            return ''
          }
        })
      )
      ruleText = ruleResults.filter(Boolean).join('\n\n').slice(0, 800)
    }

    // 画像情報プロンプト構築
    const imgInfo = (imgData && imgData.length > 0)
      ? imgData.map((img, i) => {
          const lines = [`[画像${i + 1}]`]
          if (img.filename) lines.push(`ファイル名: ${img.filename}`)
          if (img.alt) lines.push(`既存alt属性: "${img.alt}"`)
          if (img.title) lines.push(`title属性: "${img.title}"`)
          if (img.prev) lines.push(`直前テキスト: 「${img.prev}」`)
          if (img.next) lines.push(`直後テキスト: 「${img.next}」`)
          if (!img.filename && !img.alt && !img.prev && !img.next) lines.push('（URLは取得不可だが記事内に存在する画像）')
          return lines.join('\n')
        }).join('\n\n')
      : Array.from({ length: useCount }, (_, i) =>
          `[画像${i + 1}]\n（記事内に存在する画像。テキストの文脈から推測してください）`
        ).join('\n\n')

    const system = `あなたはWordPress記事のSEO・アクセシビリティ専門家です。
${ruleText ? `\n以下のaltルール・ガイドラインに必ず従ってください：\n${ruleText}\n` : ''}
出力はJSONのみ。マークダウンのコードブロック・前置き・後置き一切不要。`

    const userMsg = `以下の記事に含まれる画像${useCount}枚すべてのaltテキストを生成してください。

【記事本文】
${allText}

【画像情報（${imgData ? imgData.length : 0}枚検出）】
${imgInfo}

各画像にaltテキストを2案ずつ生成してください。
- 日本語で20〜60文字
- 記事の文脈・前後テキストを必ず反映
- SEOキーワードを自然に含める
- 「〜の画像」「〜の写真」などの冗長表現は使わない
- 装飾的・意味のない画像には空文字列("")を推奨

出力形式:
{"results":[{"index":1,"filename":"名前","alts":["案A","案B"],"reason":"選定理由20字以内","isDecorative":false}]}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userMsg }]
    })

    const raw = response.content.find(c => c.type === 'text')?.text || ''
    const clean = raw.replace(/```json|```/g, '').trim()
    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0])
      else throw new Error('JSONパース失敗: ' + clean.slice(0, 100))
    }

    return res.status(200).json({ results: parsed.results || [], ruleApplied: !!ruleText })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}
