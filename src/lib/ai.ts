import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GenerationConfig } from '../types/api.ts'

/** Legacy helper — prefer REST {@link generateImage} / {@link generateOneImage} for image models. */
export function createGenAiClient(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey)
}

const GEMINI_REST =
  'https://generativelanguage.googleapis.com/v1beta/models'

const MAX_GEMINI_IMAGE_EDGE = 4096

type InlinePartApi = {
  inline_data?: { mime_type?: string; data?: string }
  inlineData?: { mimeType?: string; data?: string }
}

function getApiKey(): string | undefined {
  const k = import.meta.env.VITE_GOOGLE_API_KEY
  return typeof k === 'string' && k.trim() !== '' ? k.trim() : undefined
}

export function hasGoogleApiKey(): boolean {
  return Boolean(getApiKey())
}

function blobFromInlinePart(part: InlinePartApi): Blob | null {
  const raw = part.inlineData ?? part.inline_data
  const data = raw?.data
  if (!data) return null
  const mime =
    (raw as { mimeType?: string }).mimeType ??
    (raw as { mime_type?: string }).mime_type ??
    'image/png'
  try {
    const binary = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    return new Blob([binary], { type: mime })
  } catch {
    return null
  }
}

function extractBlobsFromResponse(data: unknown): Blob[] {
  const res = data as {
    candidates?: Array<{
      content?: { parts?: InlinePartApi[] }
    }>
  }
  const parts = res.candidates?.[0]?.content?.parts ?? []
  const out: Blob[] = []
  for (const p of parts) {
    const b = blobFromInlinePart(p)
    if (b) out.push(b)
  }
  return out
}

async function toReferenceParts(
  referenceBlobs?: { blob: Blob; mimeType: string }[],
): Promise<{ mimeType: string; dataBase64: string }[] | undefined> {
  if (!referenceBlobs?.length) return undefined
  const referenceParts: { mimeType: string; dataBase64: string }[] = []
  for (const { blob, mimeType } of referenceBlobs) {
    const buf = await blob.arrayBuffer()
    let bin = ''
    const bytes = new Uint8Array(buf)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    referenceParts.push({
      mimeType: mimeType || blob.type || 'image/png',
      dataBase64: btoa(bin),
    })
  }
  return referenceParts
}

/** Map UI tier to Gemini `imageConfig.imageSize` when supported. */
function effectiveGeminiImageSize(
  resolution: string | undefined,
  _model: string,
): { imageSize: string; warned: boolean } {
  const tier = resolution === '1K' || resolution === '4K' ? resolution : '2K'
  const imageSize: string = tier
  const warned = false

  return { imageSize, warned }
}

async function geminiGenerateOnce(params: {
  model: string
  prompt: string
  aspectRatio: string
  imageSize: string
  signal?: AbortSignal
  referenceParts?: { mimeType: string; dataBase64: string }[]
}): Promise<Blob[]> {
  const key = getApiKey()
  if (!key) throw new Error('缺少 VITE_GOOGLE_API_KEY')

  const { model, prompt, aspectRatio, imageSize, signal, referenceParts } = params

  const userParts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  > = []

  if (referenceParts?.length) {
    for (const ref of referenceParts) {
      userParts.push({
        inline_data: { mime_type: ref.mimeType, data: ref.dataBase64 },
      })
    }
  }
  userParts.push({ text: prompt })

  const imageConfig: Record<string, string> = {
    aspectRatio,
    imageSize,
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: userParts,
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig,
    },
  }

  const url = `${GEMINI_REST}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`

  console.log('[image/gen] generating... API call', {
    model,
    aspectRatio,
    imageSize,
    hasRefs: Boolean(referenceParts?.length),
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  const json: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = json as { error?: { message?: string; status?: string } }
    const msg = err.error?.message ?? res.statusText ?? 'Gemini request failed'
    if (/imageSize|resolution|size/i.test(msg)) {
      console.warn('[image/gen] Gemini rejected imageConfig size — try lower resolution', msg)
    }
    throw new Error(msg)
  }

  return extractBlobsFromResponse(json)
}

export type OneImageConfig = {
  prompt: string
  model: string
  ratio?: string
  /** 1K / 2K / 4K — short-edge tier */
  resolution?: string
}

/** Derive display pixels from ratio + resolution tier (short edge = 1024 / 2048 / 4096). */
export function pixelSizeFromRatioAndResolution(
  ratio: string,
  resolution: string | undefined,
): { w: number; h: number } {
  const shortPx =
    resolution === '1K' ? 1024 : resolution === '4K' ? 4096 : 2048
  const parts = ratio.split(':').map((x) => Number.parseFloat(x))
  const rw = Number.isFinite(parts[0]) && parts[0]! > 0 ? parts[0]! : 1
  const rh = Number.isFinite(parts[1]) && parts[1]! > 0 ? parts[1]! : 1

  let w: number
  let h: number
  if (rw >= rh) {
    h = shortPx
    w = Math.round((shortPx * rw) / rh)
  } else {
    w = shortPx
    h = Math.round((shortPx * rh) / rw)
  }

  const maxEdge = Math.max(w, h)
  if (maxEdge > MAX_GEMINI_IMAGE_EDGE) {
    const scale = MAX_GEMINI_IMAGE_EDGE / maxEdge
    w = Math.round(w * scale)
    h = Math.round(h * scale)
    console.warn('[image/gen] canvas frame dimensions capped to max edge', MAX_GEMINI_IMAGE_EDGE, {
      w,
      h,
    })
  }

  return { w, h }
}

/** Single image (one Gemini response). Per-slot abort via `signal`. */
export async function generateOneImage(
  config: OneImageConfig,
  options?: {
    signal?: AbortSignal
    referenceBlobs?: { blob: Blob; mimeType: string }[]
  },
): Promise<Blob> {
  if (!getApiKey()) throw new Error('需在 .env.local 设置 VITE_GOOGLE_API_KEY')

  const aspectRatio = config.ratio ?? '1:1'
  const resolution = config.resolution ?? '2K'
  const { imageSize } = effectiveGeminiImageSize(resolution, config.model)

  const referenceParts = await toReferenceParts(options?.referenceBlobs)
  const blobs = await geminiGenerateOnce({
    model: config.model,
    prompt: config.prompt,
    aspectRatio,
    imageSize,
    signal: options?.signal,
    referenceParts,
  })
  if (!blobs.length) {
    throw new Error('模型未返回图片（检查模型 ID 与 API 权限）')
  }
  return blobs[0]
}

/**
 * Text-to-image or image-to-image (when `referenceBlobs` set) via Gemini REST.
 * Fulfills `config.count` by parallel single-image calls.
 */
export async function generateImage(
  config: GenerationConfig,
  options?: {
    signal?: AbortSignal
    referenceBlobs?: { blob: Blob; mimeType: string }[]
  },
): Promise<Blob[]> {
  if (!getApiKey()) throw new Error('需在 .env.local 设置 VITE_GOOGLE_API_KEY')

  const referenceBlobs = options?.referenceBlobs
  const refEncoded = await toReferenceParts(referenceBlobs)

  const n = config.count
  const aspectRatio = config.ratio ?? '1:1'
  const resolution = config.resolution ?? '2K'
  const { imageSize } = effectiveGeminiImageSize(resolution, config.model)

  const tasks: Promise<Blob[]>[] = []
  for (let i = 0; i < n; i++) {
    tasks.push(
      geminiGenerateOnce({
        model: config.model,
        prompt: config.prompt,
        aspectRatio,
        imageSize,
        signal: options?.signal,
        referenceParts: refEncoded,
      }),
    )
  }

  const results = await Promise.all(tasks)
  const blobs: Blob[] = []
  for (const r of results) {
    if (r.length === 0) {
      throw new Error('模型未返回图片（检查模型 ID 与 API 权限）')
    }
    blobs.push(r[0])
  }
  return blobs
}
