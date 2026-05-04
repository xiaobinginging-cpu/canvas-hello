import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const path = url.pathname.replace(/^\/api\/apimart\//, '')
  const queryString = url.search
  const targetUrl = `https://api.apimart.ai/${path}${queryString}`

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
    const message = e instanceof Error ? e.message : 'unknown error'
    res.status(500).json({ error: 'apimart proxy failed', message })
  }
}
