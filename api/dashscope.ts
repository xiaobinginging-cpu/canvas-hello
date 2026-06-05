import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * 百炼（DashScope）原生 API 代理：`/api/dashscope/<subpath>` → `https://dashscope.aliyuncs.com/<subpath>`。
 * 解决浏览器 CORS。用于视频合成异步任务（提交 + 轮询）。key 走客户端 BYOK（千问），Authorization 原样转发。
 * 透传 `X-DashScope-Async`（提交异步任务需要）。单文件 + vercel.json 重写（catch-all 本项目不识别）。
 */
const UPSTREAM = 'https://dashscope.aliyuncs.com'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const subpath = url.pathname.replace(/^\/api\/dashscope\//, '')
  const target = `${UPSTREAM}/${subpath}${url.search}`

  try {
    const headers: Record<string, string> = {
      Authorization: req.headers.authorization || '',
      'Content-Type': req.headers['content-type'] || 'application/json',
    }
    const async = req.headers['x-dashscope-async']
    if (async) headers['X-DashScope-Async'] = String(async)

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    })

    const text = await upstream.text()
    res
      .status(upstream.status)
      .setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
      .setHeader('Cache-Control', 'no-store')
      .send(text)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/dashscope]', e)
    res.status(500).json({ error: 'dashscope proxy failed', message })
  }
}
