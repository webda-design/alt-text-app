import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ALT_RULES = `
あなたはWCAG 2.0・JIS X 8341-3・Science Tokyo デザインシステムのaltルールを完全習得した専門家です。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【判定フロー】必ずこの順で判定する
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP1. 画像の「種類・内容」を最初に特定する
ファイル名・前後テキスト・記事全体から画像が何であるかを判定：
- グラフ（円グラフ・棒グラフ・折れ線グラフ等）
- フローチャート・図解・インフォグラフィック
- 人物写真
- 風景・場所の写真
- 商品・物の写真
- ロゴ・バナー・ボタン
- 装飾的な画像・イメージ写真

STEP2. 種類に応じたルールを適用する

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【種類別ルール（厳守）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

■ グラフ（円グラフ・棒グラフ・折れ線グラフ等）
→ タイトルや種類だけを書いてはいけない（最重要ルール）
→ グラフが示す「主要な数値」「割合」「結論」「傾向」を必ずaltに含める
→ 本文にデータが詳述されていても、altにも主要数値を入れる
→ 良い例: 「顧客満足度調査結果。満足・やや満足の合計98%、不満・やや不満2%」
→ 悪い例: 「満足度を表すグラフ」「顧客満足度グラフ」（数値がない、「〜グラフ」で終わる）
→ グラフのタイトルや凡例に数値があれば必ずaltに含める

■ フローチャート・図解
→ 何のフローか＋主要ステップ数や概要
→ 例: 「会員登録フロー。メール入力→確認メール→本登録の3ステップ」

■ 人物写真
→ 名前特定可能: 「山田太郎教授が講演している様子」
→ 不特定: 「スタッフが来場者に説明している様子」
→ 写真・画像という言葉は使わない

■ 風景・場所・建物
→ 「○○のキッチンショールーム展示スペース」など場所と特徴
→ 写真・画像という言葉は使わない

■ 商品・物
→ 商品名・色・特徴 「白色のシステムキッチン アイランド型」

■ ロゴ
→ 画像内の文字をそのままaltに 「タカラスタンダード株式会社」

■ バナー・ボタン（文字入り）
→ 画像内の文字をそのままaltに

■ 装飾的画像・単なるイメージ写真（内容理解に不要）
→ alt="" （空文字）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【絶対禁止事項】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
× 「〜の画像」「〜の写真」「〜のイラスト」「〜を表すグラフ」で終わる表現
× グラフのaltに数値・割合・結論を含めないこと
× 前後テキストをそのままコピーしてaltにすること
× 200文字を超える長文
× 推測で存在しない情報を作ること
× 「グラフ」「チャート」という言葉でaltを終わらせること

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【重要な考え方】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
altテキストは「目が見えない人がその画像を見た時に何を知りたいか」を想像して書く。
グラフの場合、見えない人が知りたいのは「で、何%だったの？」という数値・結論。
「グラフがある」という事実ではない。
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
        if (!img.filename && !img.alt && !img.prev && !img.next) {
          lines.push('（前後テキスト取得不可。記事全体の文脈から画像の種類と内容を推測してください）')
        }
        return lines.join('\n')
      }).join('\n\n')
    : Array.from({ length: useCount }, (_, i) =>
        `[画像${i + 1}]\n（位置情報なし。記事全体の文脈から推測してください）`
      ).join('\n\n')

  const system = `${ALT_RULES}
出力はJSONのみ。マークダウンのコードブロック・前置き・後置き一切不要。`

  const userMsg = `以下の記事の画像${useCount}枚のaltテキストを生成してください。

【記事全文（必ず全体を参照してください）】
${allText}

【画像情報】
${imgInfo}

各画像について以下の手順で処理してください：
1. まず画像の「種類」を特定する（グラフ／人物写真／風景／商品／ロゴ／装飾 等）
2. 種類に応じたルールを適用する
3. グラフの場合は必ず記事全文から数値・割合を探してaltに含める
4. 装飾的と判断した場合はalts:["",""]とisDecorative:trueにする

出力形式（JSONのみ、他は一切出力しない）:
{"results":[{"index":1,"filename":"ファイル名","imageType":"グラフ|人物写真|風景写真|商品写真|ロゴ|バナー|装飾|その他","alts":["推奨alt案A","推奨alt案B"],"reason":"種類の判定根拠と採用したルール","isDecorative":false}]}`

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
