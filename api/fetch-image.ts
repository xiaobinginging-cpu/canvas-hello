import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * 生成结果下载代理：APImart 部分模型（GPT Image 2）的结果图放在不带 CORS 头的 CDN
 * （getapib.org），浏览器直连被拒——服务端拉取后流式回传。
 * 仅放行 APImart 已知结果域名，防 SSRF。
 */
const ALLOWED_HOST_SUFFIXES = ['apimart.ai', 'getapib.org']

function hostAllowed(hostname: string): boolean {
  return ALLOWED_HOST_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`))
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = typeof req.query.url === 'string' ? req.query.url : ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    res.status(400).json({ error: 'invalid url' })
    return
  }
  if (url.protocol !== 'https:' || !hostAllowed(url.hostname)) {
    res.status(403).json({ error: `host not allowed: ${url.hostname}` })
    return
  }

  try {
    const upstream = await fetch(url.toString())
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `upstream ${upstream.status}` })
      return
    }
    res.status(200)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    if (!upstream.body) {
      res.end()
      return
    }
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
    res.end()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/fetch-image]', message)
    if (!res.headersSent) res.status(500).json({ error: 'fetch-image proxy failed', message })
    else res.end()
  }
}
