import type { Image } from '../types/image.ts'
import type {
  CanvasData,
  TextCard,
  TextCardPromptGenSource,
  TextCardSource,
  VideoItem,
} from '../types/project'

/**
 * GitHub `canvas.json` may still contain transient fields (`isLoading`, `uploadError`)
 * from an interrupted session. Reset after `loadProject` so clients re-fetch assets
 * and never treat persisted `isLoading: true` as “still uploading”.
 */
function normalizeTextCardSource(raw: TextCard['source']): TextCardSource | undefined {
  if (raw == null) return { kind: 'manual' }
  if (typeof raw === 'object' && raw !== null && 'kind' in raw) {
    const k = (raw as { kind?: string }).kind
    if (k === 'manual') return { kind: 'manual' }
    if (k === 'prompt-gen') return raw as TextCardPromptGenSource
  }
  const o = raw as unknown as Record<string, unknown>
  if ('generatedAt' in o && 'api' in o) {
    return {
      kind: 'prompt-gen',
      sourceImageIds: Array.isArray(o.sourceImageIds) ? (o.sourceImageIds as string[]) : [],
      api: o.api === 'kimi' ? 'kimi' : 'google',
      model: String(o.model ?? ''),
      instruction: o.instruction != null ? String(o.instruction) : undefined,
      generatedAt: typeof o.generatedAt === 'number' ? o.generatedAt : Date.now(),
    }
  }
  return { kind: 'manual' }
}

export function normalizeCanvasFromServer(canvas: CanvasData): CanvasData {
  const images: Image[] = []
  for (const img of canvas.images) {
    images.push({
      ...img,
      isLoading: false,
      uploadError: undefined,
    })
  }
  const textCards: TextCard[] = (canvas.textCards ?? []).map((tc) => ({
    ...tc,
    source: normalizeTextCardSource(tc.source),
  }))

  const videos: VideoItem[] = (canvas.videos ?? []).map((v) => ({
    ...v,
    isLoading: false,
    uploadError: undefined,
  }))

  console.log(
    `[hydrate] reset isLoading: ${images.length} images, videos=${videos.length}, textCards=${textCards.length}`,
  )
  return {
    ...canvas,
    images,
    videos,
    textCards,
  }
}
