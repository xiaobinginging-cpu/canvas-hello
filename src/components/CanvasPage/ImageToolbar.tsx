import { Download, FolderPlus, Info, RotateCcw } from 'lucide-react'
import { downloadObjectUrl } from '../../lib/downloadObjectUrl.ts'
import { coerceApimartModelId } from '../../lib/apimartGen.ts'
import { runMidjourneyUpscale } from '../../lib/canvasGeneration.ts'
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
  const openSaveToLibrary = useProjectStore((s) => s.openSaveToLibrary)

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
        title="存入素材库"
        disabled={image.isLoading || image.src === 'pending'}
        className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => openSaveToLibrary(image.id)}
      >
        <FolderPlus size={16} strokeWidth={2} aria-hidden />
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
      {image.metadata.mjTaskId ? (
        <>
          <div className="mx-0.5 h-5 w-px self-center bg-neutral-200" aria-hidden />
          {image.metadata.mjIndex && image.metadata.mjIndex >= 1 && image.metadata.mjIndex <= 4 ? (
            <button
              type="button"
              title="放大这张（Midjourney upscale，按次计费）"
              disabled={image.isLoading || image.src === 'pending'}
              className="rounded px-1.5 py-1 text-[11px] font-medium text-neutral-900 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() =>
                void runMidjourneyUpscale(image.id, image.metadata.mjIndex as 1 | 2 | 3 | 4)
              }
            >
              放大
            </button>
          ) : (
            /* 旧数据兜底：没有变体序号的早期 MJ 图保留 U1-U4 */
            ([1, 2, 3, 4] as const).map((i) => (
              <button
                key={i}
                type="button"
                title={`放大第 ${i} 张变体（Midjourney upscale，按次计费）`}
                disabled={image.isLoading || image.src === 'pending'}
                className="rounded px-1.5 py-1 text-[11px] font-medium text-neutral-900 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void runMidjourneyUpscale(image.id, i)}
              >
                U{i}
              </button>
            ))
          )}
        </>
      ) : null}
    </div>
  )
}
