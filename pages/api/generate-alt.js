import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALT_RULES = `
あなたはWCAG 2.0・JIS X 8341-3・Science Tokyo デザインシステムのaltルールを完全習得した専門家です。

以下は両ガイドラインから学習した正確なルールです。厳密に従ってください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【判定フロー】必ずこの順で判断する
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q1. 装飾的な画像か？（罫線・スペーサー・背景・雰囲気演出のみの写真・タイトルに添えられたイメージ写真）
→ YES: alt="" （空文字を返す）

Q2. 文字を含む画像か？（ロゴ・ボタン・バナー・タイトル文字画像）
→ YES: 画像内に書かれている文字をそのままaltにする

Q3. グラフ・チャート・図解・フローチャート・インフォグラフィックか？
→ YES: 【グラフルール】を適用する（最重要）

Q4. 人物写真か？
→ YES: 「○○の写真」または「○○の様子」の形式で記述する

Q5. 風景・場所・建物・商品の写真か？
→ YES: 何が写っているかを具体的に記述する

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【グラフルール（Q3のYES・最重要）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

JIS X 8341-3 事例15・16より：
グラフ画像のaltには、グラフが示す「主要なデータ・数値・割合・結論・傾向」を記述する。
グラフのタイトルや種類だけをaltにしてはいけない。

■ 数値の取得方法（優先順位順）：
1. 画像の直前・直後テキストに数値がある → そのまま使う
2. 画像のキャプション（figcaption等）に数値がある → そのまま使う
3. 記事全文の中に関連する数値がある → 探して使う
4. どこにも数値がない → グラフのタイトル＋「詳細は本文参照」と記述する

■ 具体的な記述例：
・円グラフ: 「アドバイザー対応満足度。大変満足72%、満足26%、不満1%、大変不満1%未満」
・棒グラフ: 「アドバイザーのコミュニケーション満足度内訳。よく話を聞いてくれた73%、親しみやすかった63%、説明が分かりやすかった53%、適切に案内してくれた44%、適切に代替案を出してくれた41%」
・本文に詳細あり: 「○○の調査結果グラフ。詳細は下記参照」

■ 絶対禁止：
× 「〜を表すグラフ」「〜グラフ」だけで終わる → 数値がない
× 「アドバイザーの対応グラフ」→ 何も伝わらない
× 前後テキストの文章をそのままコピー

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【人物写真ルール（Q4のYES）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

JIS X 8341-3 事例5より：
・名前が特定できる: 「○○の写真」（例：「理事長 岡本幸助の写真」）
・状況・行動を伝える: 「○○の様子」（例：「車いすの人を含む6人が会議している様子」）
・文章のイメージ写真（装飾目的）: alt=""
・同ページに同じ人物の写真が複数ある場合: 同じaltを繰り返さず、状況を変えて記述

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【共通禁止事項】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
× 「〜の画像」「〜の写真」という表現（写真は例外として使用可）
× 「〜のイラスト」「〜の図」で終わる表現
× 200文字を超える長文
× 推測で存在しない数値・情報を作ること
× 前後テキストをそのままコピーしてaltにすること
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
        if (img.caption) lines.push(`キャプション: 「${img.caption}」`)
        if (img.prev) lines.push(`直前テキスト（長め）: 「${img.prev}」`)
        if (img.next) lines.push(`直後テキスト（長め）: 「${img.next}」`)
        if (!img.filename && !img.alt && !img.prev && !img.next) {
          lines.push('（前後テキスト取得不可。記事全文から数値・内容を探してください）')
        }
        return lines.join('\n')
      }).join('\n\n')
    : Array.from({ length: useCount }, (_, i) =>
        `[画像${i + 1}]\n（位置情報なし。記事全文から内容を推測してください）`
      ).join('\n\n')

  const system = `${ALT_RULES}
出力はJSONのみ。マークダウンのコードブロック・前置き・後置き一切不要。`

  const userMsg = `以下の記事に含まれる画像${useCount}枚のaltテキストを生成してください。

【記事全文（数値・データが含まれます。グラフのaltに必ず活用してください）】
${allText}

【各画像の情報】
${imgInfo}

処理手順：
1. 画像ごとに判定フロー（Q1〜Q5）を実行して種類を特定する
2. グラフと判定した場合：記事全文を必ず検索し、その画像に対応する数値・割合・項目名を全て抽出してaltに含める。数値なしはNG。
3. 人物写真と判定した場合：「○○の写真」または「○○の様子」形式で記述する
4. 装飾と判定した場合：alts:["",""] isDecorative:true を返す

出力形式（JSONのみ）:
{"results":[{"index":1,"filename":"ファイル名","imageType":"円グラフ|棒グラフ|フローチャート|人物写真|風景写真|商品写真|ロゴ|バナー|装飾|その他","alts":["推奨alt案A","推奨alt案B"],"reason":"判定根拠と使用したルール・数値の出典","isDecorative":false}]}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
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
