import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = Array.isArray(req.query.path)
    ? req.query.path.join('/')
    : (req.query.path || '')
  const targetUrl = `https://api.apimart.ai/${path}`

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        Authorization: req.headers.authorization || '',
        'Content-Type': req.headers['content-type'] || 'application/json',
      },
      body:
        req.method !== 'GET' && req.method !== 'HEAD'
          ? JSON.stringify(req.body)
          : undefined,
    })

    const contentType = upstream.headers.get('content-type') || 'application/json'
    const data = await upstream.text()

    res.status(upstream.status).setHeader('Content-Type', contentType).send(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: 'proxy failed', message })
  }
}
