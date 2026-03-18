import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALT_RULES = `
あなたはWCAG 2.0・JIS X 8341-3およびScience Tokyoデザインシステムのaltルールを完全に習得した専門家です。
以下のルールに厳密に従ってaltテキストを生成してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【判定フロー】画像を以下の順で判定する
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q1. 装飾的な画像か？（罫線・背景・スペーサー・雰囲気演出のみの写真）
→ YES: alt="" （空文字。理由：装飾画像に代替テキストは不要）

Q2. 文字を含む画像か？
→ YES: 画像内の文字をそのまま代替テキストにする
  ・読ませたい文字がある → 画像内の文字をそのままaltに
  ・文字だけでは説明不足 → 文字＋補足説明をaltに
  ・リンク・ボタンの文字画像 → リンク先・機能を示すテキストをaltに

Q3. 前後の文脈・ページ内容にとって意味のある画像か？
→ YES: 画像が伝える内容をaltに（下記カテゴリ別ルール参照）

Q4. いずれにも当てはまらない
→ スクリーンリーダーで読み上げたとき必要かどうかで判断。不要ならalt=""

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【カテゴリ別ルール（Q3のYESの場合）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ ロゴ画像
→ 画像に書かれた文字とまったく同じ文字をaltに
→ 例: alt="アイ・コラボ株式会社"
→ （株）は「株式会社」と書く（スクリーンリーダーが「カッコカブカッコ」と読む）

■ 人物写真
→ 名前が特定できる場合: alt="山田太郎教授"
→ 不特定の場合: 状況・行動を記述 alt="学生が実験室で研究している様子"

■ 風景写真
→ 場所・状況の特徴を簡潔に alt="キャンパスの桜並木"

■ 物の写真
→ 商品名・特徴を記述 alt="赤いルクルーゼのストウブ鍋"

■ グラフ（棒グラフ・円グラフ・折れ線グラフ等）
→ 【重要】グラフの「タイトル」や「種類」だけをaltにしてはいけない
→ グラフが示す【主要なデータ・数値・結論】をaltに記述する
→ 本文中に詳細なデータの説明がある場合はalt=""でも可
→ 棒グラフ例: alt="2023年度売上グラフ。第1四半期が最高で1,200万円"
→ 円グラフ例: alt="顧客満足度調査。満足・やや満足が合計98%、不満・やや不満が2%"
→ データが複雑な場合は本文またはtable要素で詳細を提供し、altは概要のみ

■ フローチャート・図解
→ 図が示すプロセスや関係性の概要 alt="会員登録フロー。入力→確認→完了の3ステップ"

■ マップ
→ alt="○○市の地図"など、何のマップかを示す

■ バナー（文字主体）
→ バナーに書かれている文字をそのままaltに

■ バナー（画像主体）
→ バナーの内容・目的を簡潔に

■ イメージ写真（装飾的だが文脈に関連）
→ 原則alt=""
→ ページの内容理解に必要な場合のみ簡潔に

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【絶対に守るルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

× 「〜の画像」「〜の写真」「〜のイラスト」は使わない
  （スクリーンリーダーがすでに「画像」と読み上げるため冗長）
× グラフのaltに「〜グラフ」とだけ書いてはいけない（数値・結論を入れる）
× 前後テキストをそのままコピーしてaltにしてはいけない
× 長文にしない（目安200文字以内、できれば1〜2文）
× 推測で存在しない情報を作らない
○ 本文中に詳細な説明がある画像はalt=""でよい
○ 「画像」「写真」「イラスト」という言葉は使わない
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
        if (!img.filename && !img.alt && !img.prev && !img.next) lines.push('（前後テキスト取得不可。記事全体の文脈から判断してください）')
        return lines.join('\n')
      }).join('\n\n')
    : Array.from({ length: useCount }, (_, i) =>
        `[画像${i + 1}]\n（位置情報なし。記事全体の文脈から画像の役割を推測してください）`
      ).join('\n\n')

  const system = `${ALT_RULES}

出力はJSONのみ。マークダウンのコードブロック・前置き・後置き一切不要。`

  const userMsg = `以下の記事に含まれる画像${useCount}枚のaltテキストを生成してください。

【記事全文】
${allText}

【画像情報】
${imgInfo}

各画像について、上記のルール（判定フロー・カテゴリ別ルール）に従い、正しいaltテキストを生成してください。

特に以下を厳守：
- グラフ系画像は必ず数値や結論をaltに含める（タイトルだけはNG）
- 装飾的・イメージ的な画像はalt=""を推奨
- 「〜の画像」「〜の写真」などの表現は絶対に使わない
- 前後テキストをそのままコピーしない

出力形式（JSONのみ）:
{"results":[{"index":1,"filename":"ファイル名","alts":["推奨alt案A","推奨alt案B"],"reason":"判定理由と根拠","isDecorative":false}]}`

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
