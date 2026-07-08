/** APIMart async image generation（官方模型 id + 轮询）。 */

import {
  getApiKey,
  invalidApiKeyMessage,
  missingApiKeyMessage,
} from './apiKeys.ts'

export type APImartModel =
  | 'gemini-3.1-flash-image-preview-official'
  | 'gemini-3-pro-image-preview-official'
  | 'gpt-image-2-official'
  | 'doubao-seedream-5-0-lite'

export const APIMART_MODEL_IDS: readonly APImartModel[] = [
  'gemini-3.1-flash-image-preview-official',
  'gemini-3-pro-image-preview-official',
  'gpt-image-2-official',
  'doubao-seedream-5-0-lite',
]

/** 默认：Banana 2 official（更便宜更快）。 */
export const DEFAULT_APIMART_MODEL: APImartModel = 'gemini-3.1-flash-image-preview-official'

export const APIMART_IMAGE_MODEL_OPTIONS: readonly {
  value: APImartModel
  label: string
}[] = [
  {
    value: 'gemini-3.1-flash-image-preview-official',
    label: 'Banana 2',
  },
  { value: 'gemini-3-pro-image-preview-official', label: 'Banana Pro' },
  { value: 'gpt-image-2-official', label: 'GPT Image 2' },
  { value: 'doubao-seedream-5-0-lite', label: '即梦 5.0 Lite' },
]

const LEGACY_APIMART_MODEL_MAP: Partial<Record<string, APImartModel>> = {
  'gemini-3-pro-image-preview': 'gemini-3-pro-image-preview-official',
  'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image-preview-official',
}

export function coerceApimartModelId(raw: string | undefined): APImartModel {
  if (raw && (APIMART_MODEL_IDS as readonly string[]).includes(raw)) {
    return raw as APImartModel
  }
  if (raw && LEGACY_APIMART_MODEL_MAP[raw]) {
    return LEGACY_APIMART_MODEL_MAP[raw]!
  }
  return DEFAULT_APIMART_MODEL
}

export function apimartBaseURL(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/apimart/v1`
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:5273/api/apimart/v1'
  }
  return 'https://api.apimart.ai/v1'
}

export function hasApimartApiKey(): boolean {
  return Boolean(getApiKey('apimart'))
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const POLL_INTERVAL_MS = 3000
// GPT Image 2 官方预估 ~100s/张，n>1 更久；3 分钟必超时（视频同款问题，对齐 video 的 10 分钟）
const TIMEOUT_MS = 600_000

function extractImageUrlsFromPollPayload(payload: unknown): string[] {
  const p = payload as
    | { result?: { images?: Array<{ url?: unknown }> } }
    | undefined
  const urls: string[] = []
  for (const img of p?.result?.images ?? []) {
    if (img && typeof img === 'object' && 'url' in img) {
      const u = (img as { url: unknown }).url
      if (typeof u === 'string') urls.push(u)
      else if (Array.isArray(u)) {
        for (const x of u) if (typeof x === 'string') urls.push(x)
      }
    }
  }
  return urls
}

export async function generateViaAPImart(opts: {
  model: APImartModel
  prompt: string
  size: string
  resolution: '1K' | '2K' | '4K'
  n: number
  imageBlobs?: Blob[]
}): Promise<Blob[]> {
  const apiKey = getApiKey('apimart')
  if (!apiKey) {
    throw new Error(missingApiKeyMessage('apimart'))
  }

  const base = apimartBaseURL()

  let resolution = opts.resolution
  if (opts.model === 'doubao-seedream-5-0-lite' && resolution === '1K') {
    resolution = '2K'
    console.log('[apimart] coerced resolution 1K → 2K for 即梦')
  }

  const submitBody: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    size: opts.size,
    resolution,
    n: opts.n,
  }
  if (opts.imageBlobs?.length) {
    submitBody.image_urls = await Promise.all(
      opts.imageBlobs.map(async (b) => {
        const mime = b.type || 'image/png'
        const b64 = await blobToBase64(b)
        return `data:${mime};base64,${b64}`
      }),
    )
  }

  const submitResp = await fetch(`${base}/images/generations`, {
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
    throw new Error(`[apimart/submit] invalid JSON ${submitResp.status}`)
  }

  const errObj = (submitData as { error?: { message?: string } }).error
  if (errObj) {
    const msg = errObj.message ?? JSON.stringify(errObj)
    console.error('[apimart] error →', msg)
    throw new Error(`[apimart/submit] ${msg}`)
  }
  if (!submitResp.ok) {
    console.error('[apimart] error →', submitText)
    throw new Error(`[apimart/submit] HTTP ${submitResp.status}`)
  }

  const sub = submitData as { code?: number; error?: { message?: string } }
  const code = sub.code
  if (code !== undefined && code !== 0 && code !== 200) {
    throw new Error(`[apimart/submit] code ${code}: ${sub.error?.message ?? ''}`)
  }

  const data = (submitData as { data?: unknown }).data
  const taskId =
    Array.isArray(data) && data[0] && typeof (data[0] as { task_id?: string }).task_id === 'string'
      ? (data[0] as { task_id: string }).task_id
      : data &&
          typeof data === 'object' &&
          'task_id' in data &&
          typeof (data as { task_id: string }).task_id === 'string'
        ? (data as { task_id: string }).task_id
        : undefined

  if (!taskId) {
    console.error('[apimart] error → missing task_id', submitData)
    throw new Error('[apimart/submit] missing task_id')
  }

  console.log('[apimart] submitted task=', taskId)

  const startTime = Date.now()

  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.error('[apimart] error → timeout')
      throw new Error('[apimart/poll] timeout after 3 minutes')
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
      console.error('[apimart] error → invalid poll JSON', statusText)
      throw new Error(`[apimart/poll] invalid JSON ${statusResp.status}`)
    }

    const pollBody = statusData as { code?: number; error?: { message?: string } }
    const pollCode = pollBody.code
    if (pollCode !== undefined && pollCode !== 0 && pollCode !== 200) {
      throw new Error(`[apimart/poll] code ${pollCode}: ${pollBody.error?.message ?? ''}`)
    }

    const pollErr = statusData.error as { message?: string } | undefined
    if (pollErr) {
      const msg = pollErr.message ?? JSON.stringify(pollErr)
      console.error('[apimart] error →', msg)
      throw new Error(`[apimart/poll] ${msg}`)
    }

    const payload = statusData.data as
      | {
          status?: string
          progress?: number
          result?: { images?: Array<{ url?: string | string[] } | { url: string }> }
        }
      | undefined

    const status = payload?.status ?? ''
    const progress = payload?.progress
    console.log('[apimart] poll status=', status, 'progress=', progress)

    // 放宽完成判定（video 同款修法）：APImart 有时卡在 processing 99% 不翻 completed，但结果已出。
    // n>1 时可能中途出现部分 URL，故只有「状态完成 / URL 数够 n / progress 100 且有 URL」才算成。
    const statusLc = status.toLowerCase()
    const urls = extractImageUrlsFromPollPayload(payload)
    const isDoneStatus = ['completed', 'succeeded', 'success', 'done', 'finished'].includes(statusLc)
    const isDone =
      isDoneStatus || urls.length >= opts.n || (urls.length > 0 && (progress ?? 0) >= 100)

    if (isDone) {
      if (urls.length === 0) {
        console.error('[apimart] error → completed but no image URL', statusData)
        throw new Error('[apimart/completed] no image URL in response')
      }
      console.log('[apimart] completed, downloading', urls.length, 'images')
      const blobs = await Promise.all(
        urls.map(async (u) => {
          const r = await fetch(u)
          if (!r.ok) {
            console.error('[apimart] error → download', u, r.status)
            throw new Error(`[apimart/download] ${u} failed ${r.status}`)
          }
          return r.blob()
        }),
      )
      return blobs
    }

    if (['failed', 'error', 'cancelled', 'canceled'].includes(statusLc)) {
      console.error('[apimart] error → task', status)
      throw new Error(`[apimart] task ${status}`)
    }
  }
}
