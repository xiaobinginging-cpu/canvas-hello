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
  | 'midjourney'

export const APIMART_MODEL_IDS: readonly APImartModel[] = [
  'gemini-3.1-flash-image-preview-official',
  'gemini-3-pro-image-preview-official',
  'gpt-image-2-official',
  'doubao-seedream-5-0-lite',
  'midjourney',
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
  { value: 'midjourney', label: 'Midjourney' },
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

/**
 * 下载生成结果：先直连（快、省一次函数调用），被 CORS 拒（GPT Image 2 的结果在
 * 不带 CORS 头的 getapib.org）或非 2xx 时回退服务端代理 /api/fetch-image。
 */
export async function downloadGeneratedAsset(u: string, tag: string): Promise<Blob> {
  try {
    const r = await fetch(u)
    if (r.ok) {
      const b = await r.blob()
      if (b.size > 0) return b
    }
    console.warn(`[${tag}] direct download failed ${r.status}, falling back to proxy`, u)
  } catch (e) {
    console.warn(`[${tag}] direct download blocked (CORS?), falling back to proxy`, e)
  }
  const r2 = await fetch(`/api/fetch-image?url=${encodeURIComponent(u)}`)
  if (!r2.ok) {
    console.error(`[${tag}] error → proxy download`, u, r2.status)
    throw new Error(`[${tag}/download] ${u} failed ${r2.status}`)
  }
  const blob = await r2.blob()
  if (blob.size === 0) throw new Error(`[${tag}/download] empty blob via proxy`)
  return blob
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

/** 提交任务（images/generations、midjourney/generations、upscale 共用信封解析），返回 task_id。 */
async function submitApimartTask(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  tag: string,
): Promise<string> {
  const submitResp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (submitResp.status === 401 || submitResp.status === 403) {
    throw new Error(invalidApiKeyMessage('apimart'))
  }

  const submitText = await submitResp.text()
  let submitData: unknown
  try {
    submitData = JSON.parse(submitText) as Record<string, unknown>
  } catch {
    throw new Error(`[${tag}/submit] invalid JSON ${submitResp.status}`)
  }

  const errObj = (submitData as { error?: { message?: string } }).error
  if (errObj) {
    const msg = errObj.message ?? JSON.stringify(errObj)
    console.error(`[${tag}] error →`, msg)
    throw new Error(`[${tag}/submit] ${msg}`)
  }
  if (!submitResp.ok) {
    console.error(`[${tag}] error →`, submitText)
    throw new Error(`[${tag}/submit] HTTP ${submitResp.status}`)
  }

  const sub = submitData as { code?: number; error?: { message?: string } }
  const code = sub.code
  if (code !== undefined && code !== 0 && code !== 200) {
    throw new Error(`[${tag}/submit] code ${code}: ${sub.error?.message ?? ''}`)
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
    console.error(`[${tag}] error → missing task_id`, submitData)
    throw new Error(`[${tag}/submit] missing task_id`)
  }

  console.log(`[${tag}] submitted task=`, taskId)
  return taskId
}

/** 轮询统一任务接口直到出图，返回结果 URL 列表（放宽完成判定，同 video 修法）。 */
async function pollApimartTaskUrls(
  base: string,
  apiKey: string,
  taskId: string,
  expectedN: number,
  tag: string,
): Promise<string[]> {
  const startTime = Date.now()

  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.error(`[${tag}] error → timeout`)
      throw new Error(`[${tag}/poll] timeout after ${Math.round(TIMEOUT_MS / 60000)} minutes`)
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
      console.error(`[${tag}] error → invalid poll JSON`, statusText)
      throw new Error(`[${tag}/poll] invalid JSON ${statusResp.status}`)
    }

    const pollBody = statusData as { code?: number; error?: { message?: string } }
    const pollCode = pollBody.code
    if (pollCode !== undefined && pollCode !== 0 && pollCode !== 200) {
      throw new Error(`[${tag}/poll] code ${pollCode}: ${pollBody.error?.message ?? ''}`)
    }

    const pollErr = statusData.error as { message?: string } | undefined
    if (pollErr) {
      const msg = pollErr.message ?? JSON.stringify(pollErr)
      console.error(`[${tag}] error →`, msg)
      throw new Error(`[${tag}/poll] ${msg}`)
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
    console.log(`[${tag}] poll status=`, status, 'progress=', progress)

    // 放宽完成判定：APImart 有时卡在 processing 99% 不翻 completed，但结果已出。
    // n>1 时可能中途出现部分 URL，故只有「状态完成 / URL 数够 n / progress 100 且有 URL」才算成。
    const statusLc = status.toLowerCase()
    const urls = extractImageUrlsFromPollPayload(payload)
    const isDoneStatus = ['completed', 'succeeded', 'success', 'done', 'finished'].includes(statusLc)
    const isDone =
      isDoneStatus || urls.length >= expectedN || (urls.length > 0 && (progress ?? 0) >= 100)

    if (isDone) {
      if (urls.length === 0) {
        console.error(`[${tag}] error → completed but no image URL`, statusData)
        throw new Error(`[${tag}/completed] no image URL in response`)
      }
      return urls
    }

    if (['failed', 'error', 'cancelled', 'canceled'].includes(statusLc)) {
      console.error(`[${tag}] error → task`, status)
      throw new Error(`[${tag}] task ${status}`)
    }
  }
}

export async function generateViaAPImart(opts: {
  model: APImartModel
  prompt: string
  size: string
  resolution: '1K' | '2K' | '4K'
  n: number
  imageBlobs?: Blob[]
}): Promise<Blob[]> {
  // 安全网：MJ 走专用端点（retry 等旁路也能正确落到 MJ）
  if (opts.model === 'midjourney') {
    const { blobs } = await generateMidjourneyViaAPImart({ prompt: opts.prompt, size: opts.size })
    return blobs
  }

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

  const taskId = await submitApimartTask(`${base}/images/generations`, apiKey, submitBody, 'apimart')
  const urls = await pollApimartTaskUrls(base, apiKey, taskId, opts.n, 'apimart')
  console.log('[apimart] completed, downloading', urls.length, 'images')
  return Promise.all(urls.map((u) => downloadGeneratedAsset(u, 'apimart')))
}

/**
 * Midjourney（APImart 专用端点）：出 2×2 网格图（一张），比例经 `--ar` 拼进 prompt。
 * 返回 taskId 供后续 upscale（U1-U4）。不支持参考图。
 */
export async function generateMidjourneyViaAPImart(opts: {
  prompt: string
  size: string
}): Promise<{ blobs: Blob[]; taskId: string }> {
  const apiKey = getApiKey('apimart')
  if (!apiKey) {
    throw new Error(missingApiKeyMessage('apimart'))
  }
  const base = apimartBaseURL()
  const hasAr = /--ar\s+\d/.test(opts.prompt)
  const prompt = hasAr || !opts.size ? opts.prompt : `${opts.prompt} --ar ${opts.size}`

  const taskId = await submitApimartTask(`${base}/midjourney/generations`, apiKey, { prompt }, 'mj')
  const urls = await pollApimartTaskUrls(base, apiKey, taskId, 1, 'mj')
  console.log('[mj] completed, downloading', urls.length, 'images')
  const blobs = await Promise.all(urls.map((u) => downloadGeneratedAsset(u, 'mj')))
  return { blobs, taskId }
}

/** Midjourney 放大网格第 index 张（1-4），返回放大后的单图。 */
export async function upscaleMidjourneyViaAPImart(opts: {
  taskId: string
  index: 1 | 2 | 3 | 4
}): Promise<Blob> {
  const apiKey = getApiKey('apimart')
  if (!apiKey) {
    throw new Error(missingApiKeyMessage('apimart'))
  }
  const base = apimartBaseURL()
  const upscaleTaskId = await submitApimartTask(
    `${base}/midjourney/generations/upscale`,
    apiKey,
    { task_id: opts.taskId, index: opts.index },
    'mj/upscale',
  )
  const urls = await pollApimartTaskUrls(base, apiKey, upscaleTaskId, 1, 'mj/upscale')
  return downloadGeneratedAsset(urls[0], 'mj/upscale')
}
