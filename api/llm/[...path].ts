import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * 通用 LLM 代理：`/api/llm/<provider>/<subpath>` → 转发到上游 OpenAI 兼容端点。
 * 解决浏览器对各家 CN API 的 CORS，并**流式透传**（Kimi 老代理是缓冲的、不流式）。
 * key 走客户端 BYOK：OpenAI SDK 把 `Authorization: Bearer <key>` 发到本代理、原样转发。
 *
 * 新增一家：在 UPSTREAM 加一行 `<provider>: '<openai兼容 baseURL>'`。
 */
const UPSTREAM: Record<string, string> = {
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  kimi: 'https://api.moonshot.cn/v1',
  deepseek: 'https://api.deepseek.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  mimo: 'https://api.xiaomimimo.com/v1',
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const slug = req.query.path
  const segments = Array.isArray(slug) ? slug : slug ? [slug] : []
  const provider = segments[0] ?? ''
  const subpath = segments.slice(1).join('/')

  const base = UPSTREAM[provider]
  if (!base) {
    res.status(400).json({ error: `unknown provider: ${provider}` })
    return
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const target = `${base}/${subpath}${url.search}`

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        Authorization: req.headers.authorization || '',
        'Content-Type': req.headers['content-type'] || 'application/json',
      },
      body:
        req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    })

    res.status(upstream.status)
    const ct = upstream.headers.get('content-type') || 'application/json'
    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'no-store')

    if (!upstream.body) {
      res.end()
      return
    }

    // 流式透传：逐块写回，不缓冲整体。
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
    res.end()
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/llm]', provider, e)
    if (!res.headersSent) res.status(500).json({ error: 'llm proxy failed', message })
    else res.end()
  }
}
