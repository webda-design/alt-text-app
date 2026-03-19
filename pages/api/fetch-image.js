export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { url } = req.body
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' })
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    const mediaType = contentType.split(';')[0].trim()

    // SVGはbase64ではなくテキストとして返す
    if (mediaType === 'image/svg+xml' || url.toLowerCase().endsWith('.svg')) {
      const svgText = await response.text()
      return res.status(200).json({ svgText: svgText.slice(0, 3000), mediaType: 'image/svg+xml' })
    }

    // PNG/JPEG/GIF/WebPはbase64として返す
    const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const mt = supported.find(t => mediaType.includes(t.split('/')[1])) || 'image/jpeg'
    if (!mt) throw new Error('Unsupported image type: ' + mediaType)

    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return res.status(200).json({ base64, mediaType: mt })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
