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
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const mediaType = contentType.split(';')[0].trim()
    if (!mediaType.startsWith('image/')) throw new Error('Not an image')
    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return res.status(200).json({ base64, mediaType })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
