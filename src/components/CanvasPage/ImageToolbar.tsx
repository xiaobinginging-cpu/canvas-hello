import { Download, Info, RotateCcw } from 'lucide-react'
import { downloadObjectUrl } from '../../lib/downloadObjectUrl.ts'
import { coerceApimartModelId } from '../../lib/apimartGen.ts'
import {
  coerceImageGenRatio,
  coerceImageGenResolution,
  DEFAULT_IMAGE_GEN_CONFIG,
  useProjectStore,
} from '../../store/useStore.ts'
import type { Image as CanvasImage } from '../../types/image.ts'

function downloadFileName(image: CanvasImage): string {
  const raw = image.metadata.originalFilename?.trim()
  if (raw) return raw
  const short = image.id.slice(0, 8)
  return `generated-${short}.png`
}

export default function ImageToolbar({
  image,
  displayUrl,
}: {
  image: CanvasImage
  displayUrl: string | undefined
}) {
  const openDetailCard = useProjectStore((s) => s.openDetailCard)
  const updateImageGenConfig = useProjectStore((s) => s.updateImageGenConfig)
  const setImageGenPanelOpen = useProjectStore((s) => s.setImageGenPanelOpen)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)
  const cancelCanvasSelection = useProjectStore((s) => s.cancelCanvasSelection)

  function applyRemixFromImage(): void {
    cancelCanvasSelection()
    const m = image.metadata
    updateImageGenConfig({
      prompt: m.prompt ?? '',
      api: m.api === 'apimart' ? 'apimart' : 'google',
      model:
        m.api === 'apimart'
          ? coerceApimartModelId(m.model)
          : (m.model ?? DEFAULT_IMAGE_GEN_CONFIG.model),
      ratio: coerceImageGenRatio(m.ratio),
      resolution: coerceImageGenResolution(m.resolution),
      referenceImageIds: [...new Set([...(m.referenceImageIds ?? []), image.id])],
      count: 1,
    })
    setImageGenPanelOpen(true)
    setSelectedTool('image-gen')
  }

  return (
    <div className="no-rnd-drag pointer-events-auto relative z-[35] flex gap-0.5 rounded border border-neutral-300 bg-white p-0.5 font-mono shadow-sm">
      <button
        type="button"
        title="画同款"
        className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
        onClick={() => applyRemixFromImage()}
      >
        <RotateCcw size={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        title="下载"
        disabled={!displayUrl}
        className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => {
          if (!displayUrl) return
          downloadObjectUrl(displayUrl, downloadFileName(image))
        }}
      >
        <Download size={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        title="详情"
        className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
        onClick={() => openDetailCard(image.id)}
      >
        <Info size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}
