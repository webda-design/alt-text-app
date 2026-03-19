import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALT_RULES = `
あなたはWCAG 2.0・JIS X 8341-3・Science Tokyo デザインシステムのaltルールを完全習得した専門家です。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【画像を実際に見て判断するルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

画像が提供された場合、必ず画像の中身を直接確認してaltを生成すること。
前後テキストは補足情報として使い、画像の視覚的内容を優先する。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【判定フロー】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q1. 装飾的な画像か？（罫線・スペーサー・背景・タイトルに添えられただけのイメージ写真）
→ YES: alt="" （空文字）

Q2. 文字を含む画像か？（ロゴ・ボタン・バナー・タイトル文字）
→ YES: 画像内の文字をそのままaltにする

Q3. グラフ・チャート・図解・フローチャートか？（画像を見て確認）
→ YES: 【グラフルール】を適用する

Q4. 人物写真か？
→ YES: 「○○の写真」または「○○の様子」形式

Q5. 風景・場所・建物・商品の写真か？
→ YES: 何が写っているかを具体的に記述

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【グラフルール（最重要）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

JIS X 8341-3 事例15（棒グラフ）・事例16（円グラフ）より：

グラフのaltには「主要なデータ・数値・割合・結論」を記述する。
グラフのタイトルや種類だけをaltにしてはいけない。
「詳細は本文参照」とだけ書いてはいけない。

■ 数値の取得方法（優先順位）：
1. 画像の中に数値が書いてある → そのまま読み取って使う（最優先）
2. 画像の直前・直後テキストに数値がある → 使う
3. 記事全文に数値がある → 探して使う
4. どこにも数値がない → グラフのタイトル＋読み取れる傾向を記述

■ 記述例：
・円グラフ: 「アドバイザー対応満足度。大変満足72%、満足26%、不満1%」
・棒グラフ: 「アドバイザーのコミュニケーション満足内訳。よく話を聞いてくれた73%、親しみやすかった63%、説明が分かりやすかった53%」
・数値が読めない場合: 「○○に関する調査結果。最も高い項目は△△で、全体的に高い満足度を示している」

■ 禁止：
× 「〜グラフ」だけで終わる（数値・傾向がない）
× 「詳細は本文参照」とだけ書く
× グラフを「装飾」と誤判定する

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【人物写真ルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
・名前特定可能: 「○○の写真」
・不特定の人物・行動: 「○○の様子」
・文章のイメージ写真（装飾目的）: alt=""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【共通禁止】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
× 「〜の画像」「〜のイラスト」で終わる（「〜の写真」「〜の様子」は可）
× 200文字を超える長文
× 存在しない情報を推測で作る
`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { allText, imgData, manualCount, overrideType } = req.body

  if (!allText && (!imgData || imgData.length === 0)) {
    return res.status(400).json({ error: 'コンテンツが空です' })
  }

  const useCount = (imgData && imgData.length > 0) ? imgData.length : (manualCount || 1)

  try {
    const results = []

    for (let i = 0; i < useCount; i++) {
      const img = imgData && imgData[i] ? imgData[i] : {}

      // メッセージのコンテンツを構築
      const contentParts = []

      // 画像がbase64で提供されている場合は画像として送信
      if (img.base64 && img.mediaType) {
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.base64
          }
        })
      }

      const imgContext = []
      if (img.filename) imgContext.push(`ファイル名: ${img.filename}`)
      if (img.alt) imgContext.push(`既存alt: "${img.alt}"`)
      if (img.caption) imgContext.push(`キャプション: 「${img.caption}」`)
      if (img.prev) imgContext.push(`直前テキスト: 「${img.prev}」`)
      if (img.next) imgContext.push(`直後テキスト: 「${img.next}」`)

      const promptText = `
【記事全文】
${allText}

【この画像（画像${i + 1}/${useCount}）の情報】
${imgContext.join('\n') || '（情報なし）'}

${overrideType ? `【重要】この画像のカテゴリはユーザーが「${overrideType}」と指定しました。このカテゴリとして扱い、対応するルールでaltを生成してください。` : '上記のルールに従い、画像の種類を判定してaltテキストを生成してください。'}
${img.base64 ? '※画像が提供されています。画像の中身を直接確認してください。グラフの場合は画像内の数値を読み取って使用してください。' : '※画像は提供されていません。前後テキストと記事全文から判断してください。'}

出力はJSONのみ：
{"imageType":"${overrideType || '円グラフ|棒グラフ|フローチャート|人物写真|風景写真|商品写真|ロゴ|バナー|装飾|その他'}","alts":["alt案A","alt案B"],"reason":"判定根拠","isDecorative":${overrideType === '装飾' ? 'true' : 'false'}}
`

      contentParts.push({ type: 'text', text: promptText })

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: ALT_RULES + '\n出力はJSONのみ。コードブロック・前置き・後置き不要。',
        messages: [{ role: 'user', content: contentParts }]
      })

      const raw = response.content.find(c => c.type === 'text')?.text || ''
      const clean = raw.replace(/```json|```/g, '').trim()
      let parsed
      try { parsed = JSON.parse(clean) }
      catch (e) {
        const match = clean.match(/\{[\s\S]*\}/)
        if (match) parsed = JSON.parse(match[0])
        else parsed = { imageType: 'その他', alts: ['', ''], reason: 'パース失敗', isDecorative: false }
      }

      results.push({
        index: i + 1,
        filename: img.filename || `画像${i + 1}`,
        ...parsed
      })
    }

    return res.status(200).json({ results })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}
