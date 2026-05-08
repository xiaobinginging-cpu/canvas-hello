import { Download, RotateCcw, Trash2 } from 'lucide-react'
import { cancelVideoGeneration } from '../../lib/canvasGeneration.ts'
import { deleteVideoFromCanvas } from '../../lib/canvasUpload.ts'
import { downloadObjectUrl } from '../../lib/downloadObjectUrl.ts'
import {
  DEFAULT_VIDEO_GEN_CONFIG,
  useProjectStore,
  type VideoGenRatio,
} from '../../store/useStore.ts'
import type { VideoItem as CanvasVideo } from '../../types/project.ts'
import type { VideoQuality } from '../../types/video.ts'

function coerceVideoQuality(raw: string | undefined): VideoQuality {
  if (raw === '480p' || raw === '720p' || raw === '1080p' || raw === '4k') return raw
  if (raw === '1080P') return '1080p'
  return DEFAULT_VIDEO_GEN_CONFIG.quality
}

function downloadFileName(video: CanvasVideo): string {
  const short = video.id.slice(0, 8)
  return `video-${short}.mp4`
}

export default function VideoToolbar({
  video,
  displayUrl,
}: {
  video: CanvasVideo
  displayUrl: string | undefined
}) {
  const updateVideoGenConfig = useProjectStore((s) => s.updateVideoGenConfig)
  const setVideoGenPanelOpen = useProjectStore((s) => s.setVideoGenPanelOpen)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)
  const cancelCanvasSelection = useProjectStore((s) => s.cancelCanvasSelection)

  function applyRemixFromVideo(): void {
    cancelCanvasSelection()
    updateVideoGenConfig({
      prompt: video.prompt ?? '',
      model: video.model,
      ratio: (video.ratio as VideoGenRatio) ?? DEFAULT_VIDEO_GEN_CONFIG.ratio,
      quality: coerceVideoQuality(video.videoQuality),
      duration:
        video.duration ??
        (video.model === 'grok-imagine-1.0-video-apimart'
          ? 6
          : DEFAULT_VIDEO_GEN_CONFIG.duration),
      referenceImageIds: [...(video.referenceImageIds ?? [])],
    })
    setVideoGenPanelOpen(true)
    setSelectedTool('video-gen')
  }

  function removeOrCancel(): void {
    if (video.isLoading && video.cancelable) {
      cancelVideoGeneration(video.id)
    } else {
      void deleteVideoFromCanvas(video.id)
    }
  }

  return (
    <div className="no-rnd-drag pointer-events-auto relative z-[35] flex gap-0.5 rounded border border-neutral-300 bg-white p-0.5 font-mono shadow-sm">
      <button
        type="button"
        title="画同款"
        className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
        onClick={() => applyRemixFromVideo()}
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
          downloadObjectUrl(displayUrl, downloadFileName(video))
        }}
      >
        <Download size={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        title="删除"
        className="rounded p-1.5 text-red-800 hover:bg-red-50"
        onClick={() => removeOrCancel()}
      >
        <Trash2 size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}
