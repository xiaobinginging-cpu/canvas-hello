/** APIMart async video generation（多模型 + 轮询）。 */

import type { APImartVideoModel, VideoQuality } from '../types/video.ts'
import { apimartBaseURL } from './apimartGen.ts'
import { getApiKey, invalidApiKeyMessage, missingApiKeyMessage } from './apiKeys.ts'

export type { APImartVideoModel, VideoQuality } from '../types/video.ts'

export const APIMART_VIDEO_MODEL_OPTIONS: readonly { id: APImartVideoModel; label: string }[] = [
  { id: 'grok-imagine-1.0-video-apimart', label: 'Grok Imagine 1.0' },
  { id: 'happyhorse-1.0', label: 'HappyHorse 1.0' },
  { id: 'kling-v3', label: 'Kling V3' },
  { id: 'doubao-seedance-2.0', label: 'Seedance 2' },
]

export const DEFAULT_APIMART_VIDEO_MODEL: APImartVideoModel = 'grok-imagine-1.0-video-apimart'

function warnQualityFallback(detail: string): void {
  console.warn('[video/apimart] quality fallback warning:', detail)
}

/** 将统一 UI 档位翻译为各模型 submit body（含 quality→resolution/mode 等）。 */
export function buildVideoSubmitBody(opts: {
  model: APImartVideoModel
  prompt: string
  size: string
  duration: number
  quality: VideoQuality
}): Record<string, unknown> {
  const { model, prompt, size, duration, quality } = opts

  if (model === 'grok-imagine-1.0-video-apimart') {
    let apiQuality: '720p' | '480p'
    if (quality === '1080p' || quality === '4k') {
      warnQualityFallback(`grok: requested ${quality}, using 720p`)
      apiQuality = '720p'
    } else if (quality === '480p') {
      apiQuality = '480p'
    } else {
      apiQuality = '720p'
    }
    return {
      model,
      prompt,
      duration,
      size,
      quality: apiQuality,
    }
  }

  if (model === 'happyhorse-1.0') {
    let resolution: '1080P' | '720P'
    if (quality === '1080p') {
      resolution = '1080P'
    } else if (quality === '480p' || quality === '4k') {
      warnQualityFallback(`happyhorse: requested ${quality}, using 720P`)
      resolution = '720P'
    } else {
      resolution = '720P'
    }
    return {
      model,
      prompt,
      duration,
      size,
      resolution,
    }
  }

  if (model === 'kling-v3') {
    const mode: '4k' | 'pro' | 'std' =
      quality === '4k' ? '4k' : quality === '1080p' ? 'pro' : 'std'
    return {
      model,
      prompt,
      duration,
      aspect_ratio: size,
      mode,
    }
  }

  if (model === 'doubao-seedance-2.0') {
    let resolution: '1080p' | '720p' | '480p'
    if (quality === '4k') {
      warnQualityFallback('seedance: requested 4k, using 1080p')
      resolution = '1080p'
    } else if (quality === '1080p') {
      resolution = '1080p'
    } else if (quality === '720p') {
      resolution = '720p'
    } else {
      resolution = '480p'
    }
    return {
      model,
      prompt,
      duration,
      size,
      resolution,
    }
  }

  throw new Error(`[video/apimart] unsupported model: ${model}`)
}

const POLL_INTERVAL_MS = 5000
const TIMEOUT_MS = 600_000

function extractVideoUrlsFromPollPayload(payload: unknown): string[] {
  const urls: string[] = []
  const p = payload as {
    result?: {
      videos?: unknown
      video?: unknown
      images?: unknown
    }
  }
  const pushUrl = (u: unknown) => {
    if (typeof u === 'string') urls.push(u)
  }

  const vids = p?.result?.videos
  if (Array.isArray(vids)) {
    urls.push(
      ...vids.flatMap((v) => {
        if (!v || typeof v !== 'object' || !('url' in v)) return []
        const u = (v as { url: unknown }).url
        if (Array.isArray(u)) return u.filter((x): x is string => typeof x === 'string')
        if (typeof u === 'string') return [u]
        return []
      }),
    )
  }

  const single = p?.result?.video
  if (single && typeof single === 'object' && 'url' in single) {
    pushUrl((single as { url: unknown }).url)
  } else if (typeof single === 'string') {
    pushUrl(single)
  }

  const imgs = p?.result?.images
  if (Array.isArray(imgs)) {
    for (const img of imgs) {
      if (img && typeof img === 'object' && 'url' in img) {
        const u = (img as { url: unknown }).url
        if (typeof u === 'string') urls.push(u)
        else if (Array.isArray(u)) for (const x of u) if (typeof x === 'string') urls.push(x)
      }
    }
  }

  return urls
}

export async function generateVideoViaAPImart(opts: {
  model: APImartVideoModel
  prompt: string
  size: string
  duration: number
  quality: VideoQuality
  /** http(s) only — e.g. GitHub raw URLs（不支持 data: base64） */
  imageRawUrls?: string[]
}): Promise<Blob[]> {
  const apiKey = getApiKey('apimart')
  if (!apiKey) {
    throw new Error(missingApiKeyMessage('apimart'))
  }

  const base = apimartBaseURL()

  const submitBody: Record<string, unknown> = buildVideoSubmitBody({
    model: opts.model,
    prompt: opts.prompt,
    size: opts.size,
    duration: opts.duration,
    quality: opts.quality,
  })

  if (opts.imageRawUrls?.length) {
    submitBody.image_urls = opts.imageRawUrls
    console.log('[video/apimart] submit image_urls=', opts.imageRawUrls)
  }

  const submitResp = await fetch(`${base}/videos/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submitBody),
  })

  if (submitResp.status === 401 || submitResp.status === 403) {
    throw new Error(invalidApiKeyMessage('apimart'))
  }

  const submitText = await submitResp.text()
  let submitData: unknown
  try {
    submitData = JSON.parse(submitText) as Record<string, unknown>
  } catch {
    throw new Error(`[video/apimart/submit] invalid JSON ${submitResp.status}`)
  }

  const errObj = (submitData as { error?: { message?: string } }).error
  if (errObj) {
    const msg = errObj.message ?? JSON.stringify(errObj)
    console.error('[video/apimart] error →', msg)
    throw new Error(`[video/apimart/submit] ${msg}`)
  }
  if (!submitResp.ok) {
    console.error('[video/apimart] error →', submitText)
    throw new Error(`[video/apimart/submit] HTTP ${submitResp.status}`)
  }

  const sd = submitData as {
    code?: number
    error?: { message?: string }
    data?: Array<{ task_id?: string; status?: string }>
  }
  const code = sd.code
  if (code !== undefined && code !== 0 && code !== 200) {
    throw new Error(`[video/apimart/submit] code ${code}: ${sd.error?.message ?? ''}`)
  }

  const taskId =
    Array.isArray(sd.data) && typeof sd.data[0]?.task_id === 'string'
      ? sd.data[0].task_id
      : undefined

  if (!taskId) {
    console.error('[video/apimart] error → missing task id', submitData)
    throw new Error('[video/apimart/submit] missing task id')
  }

  console.log('[video/apimart] submitted task=', taskId, 'raw=', submitData)

  const startTime = Date.now()

  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.error('[video/apimart] error → timeout')
      throw new Error('[video/apimart/poll] timeout after 10 minutes')
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const statusResp = await fetch(`${base}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (statusResp.status === 401 || statusResp.status === 403) {
      throw new Error(invalidApiKeyMessage('apimart'))
    }
    const statusText = await statusResp.text()
    let statusData: Record<string, unknown>
    try {
      statusData = JSON.parse(statusText) as Record<string, unknown>
    } catch {
      console.error('[video/apimart] error → invalid poll JSON', statusText)
      throw new Error(`[video/apimart/poll] invalid JSON ${statusResp.status}`)
    }

    const pollBody = statusData as { code?: number; error?: { message?: string } }
    const pollCode = pollBody.code
    if (pollCode !== undefined && pollCode !== 0 && pollCode !== 200) {
      throw new Error(`[video/apimart/poll] code ${pollCode}: ${pollBody.error?.message ?? ''}`)
    }

    const pollErr = statusData.error as { message?: string } | undefined
    if (pollErr) {
      const msg = pollErr.message ?? JSON.stringify(pollErr)
      console.error('[video/apimart] error →', msg)
      throw new Error(`[video/apimart/poll] ${msg}`)
    }

    const payload = statusData.data as
      | {
          status?: string
          progress?: number
          result?: unknown
        }
      | undefined

    const status = payload?.status ?? ''
    const progress = payload?.progress
    console.log('[video/apimart] poll status=', status, 'progress=', progress)

    if (status === 'completed') {
      const urls = extractVideoUrlsFromPollPayload(payload)
      if (urls.length === 0) {
        console.error('[video/apimart] error → no video urls in result', JSON.stringify(payload))
        throw new Error('[video/apimart/completed] no video URL in response')
      }
      console.log('[video/apimart] completed, downloading', urls.length, 'videos')
      const blobs = await Promise.all(
        urls.map(async (u) => {
          const r = await fetch(u)
          if (!r.ok) {
            console.error('[video/apimart] error → download', u, r.status)
            throw new Error(`[video/apimart/download] ${u} failed ${r.status}`)
          }
          return r.blob()
        }),
      )
      return blobs
    }

    if (status === 'failed') {
      console.error('[video/apimart] error → task failed')
      throw new Error('[video/apimart] task failed')
    }
  }
}
