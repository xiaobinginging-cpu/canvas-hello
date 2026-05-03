/** APIMart async image generation（官方模型 id + 轮询）。 */

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
  if (import.meta.env.DEV) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/api/apimart/v1`
    }
    return 'http://localhost:5273/api/apimart/v1'
  }
  return 'https://api.apimart.ai/v1'
}

export function hasApimartApiKey(): boolean {
  const k = import.meta.env.VITE_APIMART_API_KEY
  return typeof k === 'string' && k.trim() !== ''
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
const TIMEOUT_MS = 180_000

export async function generateViaAPImart(opts: {
  model: APImartModel
  prompt: string
  size: string
  resolution: '1K' | '2K' | '4K'
  n: number
  imageBlobs?: Blob[]
}): Promise<Blob[]> {
  const apiKey = import.meta.env.VITE_APIMART_API_KEY
  if (!apiKey?.trim()) {
    throw new Error('缺少 VITE_APIMART_API_KEY')
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
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submitBody),
  })

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
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    })
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

    if (status === 'completed') {
      const images = payload?.result?.images ?? []
      const urls: string[] = []
      for (const img of images) {
        if (img && typeof img === 'object' && 'url' in img) {
          const u = (img as { url: unknown }).url
          if (typeof u === 'string') urls.push(u)
          else if (Array.isArray(u)) {
            for (const x of u) if (typeof x === 'string') urls.push(x)
          }
        }
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

    if (status === 'failed') {
      console.error('[apimart] error → task failed')
      throw new Error('[apimart] task failed')
    }
  }
}
