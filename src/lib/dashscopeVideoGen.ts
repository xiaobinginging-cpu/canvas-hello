/** 百炼（DashScope）直连视频生成：异步合成任务（提交→轮询→下载），用千问 key。 */
import { getApiKey, invalidApiKeyMessage, missingApiKeyMessage } from './apiKeys.ts'
import type { DashscopeVideoModel, VideoQuality } from '../types/video.ts'

function dashscopeBase(): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:5273'
  return `${origin}/api/dashscope`
}

/** UI 档位 → HappyHorse resolution（仅支持 720P / 1080P，其余降级 720P）。 */
function resolutionFromQuality(quality: VideoQuality): '720P' | '1080P' {
  return quality === '1080p' ? '1080P' : '720P'
}

const POLL_INTERVAL_MS = 5000
const TIMEOUT_MS = 600_000

/**
 * HappyHorse（百炼）文生视频。按百炼标准视频合成异步 API 实现；上游报错原样透出便于校准参数。
 * @returns 视频 Blob 数组（通常 1 个）。
 */
export async function generateVideoViaDashScope(opts: {
  model: DashscopeVideoModel
  prompt: string
  ratio: string
  duration: number
  quality: VideoQuality
}): Promise<Blob[]> {
  const apiKey = getApiKey('qwen')
  if (!apiKey) throw new Error(missingApiKeyMessage('qwen'))

  const base = dashscopeBase()

  const submitResp = await fetch(
    `${base}/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: opts.model,
        input: { prompt: opts.prompt },
        parameters: {
          resolution: resolutionFromQuality(opts.quality),
          ratio: opts.ratio,
          duration: opts.duration,
        },
      }),
    },
  )

  if (submitResp.status === 401 || submitResp.status === 403) {
    throw new Error(invalidApiKeyMessage('qwen'))
  }
  const submitText = await submitResp.text()
  let sd: {
    code?: string
    message?: string
    output?: { task_id?: string; task_status?: string }
  }
  try {
    sd = JSON.parse(submitText)
  } catch {
    throw new Error(`[dashscope/submit] 非 JSON 响应 ${submitResp.status}: ${submitText.slice(0, 200)}`)
  }
  if (!submitResp.ok || sd.code) {
    throw new Error(`[dashscope/submit] ${sd.code ?? submitResp.status}: ${sd.message ?? submitText.slice(0, 300)}`)
  }
  const taskId = sd.output?.task_id
  if (!taskId) throw new Error(`[dashscope/submit] 无 task_id：${submitText.slice(0, 300)}`)

  console.log('[video/dashscope] submitted task=', taskId)
  const start = Date.now()

  for (;;) {
    if (Date.now() - start > TIMEOUT_MS) throw new Error('[dashscope/poll] 超时（10 分钟）')
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const pollResp = await fetch(`${base}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (pollResp.status === 401 || pollResp.status === 403) throw new Error(invalidApiKeyMessage('qwen'))
    const pollText = await pollResp.text()
    let pd: { output?: { task_status?: string; video_url?: string; message?: string } }
    try {
      pd = JSON.parse(pollText)
    } catch {
      throw new Error(`[dashscope/poll] 非 JSON 响应：${pollText.slice(0, 200)}`)
    }

    const status = pd.output?.task_status ?? ''
    console.log('[video/dashscope] poll status=', status)

    if (status === 'SUCCEEDED') {
      const videoUrl = pd.output?.video_url
      if (!videoUrl) throw new Error(`[dashscope] 无 video_url：${pollText.slice(0, 300)}`)
      const r = await fetch(videoUrl)
      if (!r.ok) throw new Error(`[dashscope/download] ${videoUrl} 失败 ${r.status}`)
      return [await r.blob()]
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(`[dashscope] 任务${status}：${pd.output?.message ?? pollText.slice(0, 300)}`)
    }
  }
}
