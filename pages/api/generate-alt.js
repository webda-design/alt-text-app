import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALT_RULES = `
【画像altテキストのルール（JIS X 8341-3 / WCAG 2.0準拠）】

■ 基本原則
- altテキストはスクリーンリーダーが読み上げる。視覚障害者が画像の内容を把握できるよう、画像が伝える情報をテキストで代替する
- 「画像」「写真」「イラスト」などの冗長な言葉は使わない（スクリーンリーダーがすでに「画像」と読み上げるため）
- altテキストは簡潔に。文字数目安は20〜60文字程度

■ 装飾的な画像
- 装飾目的のみの画像はalt=""（空文字）にする
- 例：罫線・背景・スペーサー画像 → alt=""

■ ロゴ・バナー画像
- サイト名や組織名をaltに入れる
- リンク付きの場合はリンク先を示す → alt="株式会社〇〇 トップページへ"

■ 人物写真
- 名前が特定できる場合は名前を → alt="山田太郎教授"
- 不特定の場合は状況・行動を記述 → alt="学生たちが図書館で勉強している様子"

■ 風景・物・動物の写真
- 場所名・商品名・特徴を簡潔に → alt="東京タワーと夕焼けの空"

■ グラフ・チャート
- データの概要や結論を記述 → alt="2024年度売上グラフ。前年比20%増を示している"

■ イメージ写真（装飾的だが文脈に関係する）
- ページのテーマを補足する程度 → alt="爽やかな朝の風景"

■ 本文中に詳しい説明がある画像
- 本文に説明がある場合はalt=""でも可、または簡潔な説明のみ

■ SEOも考慮する場合
- 自然な形でキーワードを含める（キーワード詰め込みは禁止）
`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { allText, imgData, manualCount } = req.body

  if (!allText && (!imgData || imgData.length === 0)) {
    return res.status(400).json({ error: 'コンテンツが空です' })
  }

  const useCount = (imgData && imgData.length > 0) ? imgData.length : (manualCount || 1)

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
以下のaltルール・ガイドラインに必ず従って、画像のaltテキストを生成してください。

${ALT_RULES}

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
{"results":[{"index":1,"filename":"名前","alts":["推奨alt案A","推奨alt案B"],"reason":"選定理由20字以内","isDecorative":false}]}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userMsg }]
    })

    const raw = response.content.find(c => c.type === 'text')?.text || ''
    const clean = raw.replace(/```json|```/g, '').trim()
    let parsed
    try { parsed = JSON.parse(clean) }
    catch (e) {
      const match = clean.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0])
      else throw new Error('JSONパース失敗: ' + clean.slice(0, 100))
    }

    return res.status(200).json({ results: parsed.results || [] })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}
