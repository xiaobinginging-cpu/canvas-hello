import { Loader2, Zap } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import { APIMART_VIDEO_MODEL_OPTIONS } from '../../lib/apimartVideoGen.ts'
import { hasApimartApiKey } from '../../lib/apimartGen.ts'
import { runCanvasVideoGeneration } from '../../lib/canvasGeneration.ts'
import { getGithubLogin, getRawAssetUrl } from '../../lib/github.ts'
import { useProjectStore, type VideoGenRatio } from '../../store/useStore.ts'
import type { APImartVideoModel, VideoQuality } from '../../types/video.ts'
import ReferenceImagePicker from './ReferenceImagePicker.tsx'

const VIDEO_RATIOS: { value: VideoGenRatio; label: string }[] = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
]

const GROK_DURATIONS = [6, 9, 12, 15, 18, 24, 30] as const
const HORSE_DURATIONS = [3, 5, 7, 9, 11, 13, 15] as const
const KLING_DURATIONS = [3, 5, 7, 9, 11, 13, 15] as const
const SEEDANCE_DURATIONS = [4, 5, 7, 9, 11, 13, 15] as const

const QUALITY_OPTIONS: { value: VideoQuality; label: string; title: string }[] = [
  { value: '480p', label: '480p', title: '适用模型：Grok、Seedance' },
  { value: '720p', label: '720p', title: '适用模型：全部' },
  { value: '1080p', label: '1080p', title: '适用模型：HappyHorse、Kling、Seedance' },
  {
    value: '4k',
    label: '4k',
    title: '适用模型：仅 Kling（其余模型将自动降级并在 console 警告）',
  },
]

function maxRefsForModel(model: APImartVideoModel): number {
  return model === 'grok-imagine-1.0-video-apimart' || model === 'kling-v3' ? 7 : 9
}

function defaultDurationForModel(model: APImartVideoModel): number {
  return model === 'grok-imagine-1.0-video-apimart' ? 6 : 5
}

function durationsForModel(model: APImartVideoModel): readonly number[] {
  switch (model) {
    case 'grok-imagine-1.0-video-apimart':
      return GROK_DURATIONS
    case 'happyhorse-1.0':
    case 'kling-v3':
      return KLING_DURATIONS
    case 'doubao-seedance-2.0':
      return SEEDANCE_DURATIONS
    default:
      return HORSE_DURATIONS
  }
}

/** 视频参考须已是 GitHub assets；pending / loading 拒绝 */
function validateVideoReferenceIds(refIds: string[]): string | null {
  if (refIds.length === 0) return null
  if (!getGithubLogin()) {
    return '图生视频需已登录 GitHub（用于生成参考图 raw URL）'
  }
  const projectId = useProjectStore.getState().currentProjectId
  const canvas = useProjectStore.getState().currentProjectCanvas
  if (!projectId || !canvas) return '画布未就绪'
  for (const id of refIds) {
    const img = canvas.images.find((i) => i.id === id)
    if (!img) return '某个参考图已从画布移除，请重新选择'
    if (img.isLoading || img.src === 'pending') {
      return '请等图片保存到 GitHub（路径为 assets/…）后再用作视频参考'
    }
    if (!img.src.startsWith('assets/')) {
      return '仅支持已保存到 GitHub 的图片（路径须为 assets/…）'
    }
    try {
      getRawAssetUrl(projectId, img.src)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  return null
}

function VideoGenSelectionBar() {
  const canvasSelectionIds = useProjectStore((s) => s.canvasSelectionIds)
  const commitCanvasSelection = useProjectStore((s) => s.commitCanvasSelection)
  const cancelCanvasSelection = useProjectStore((s) => s.cancelCanvasSelection)
  const n = canvasSelectionIds.length

  return (
    <div
      data-no-canvas-pan
      className="pointer-events-auto fixed bottom-16 left-1/2 z-[160] w-[min(96vw,720px)] -translate-x-1/2 rounded-lg border border-neutral-200 bg-white font-mono shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs text-neutral-800">
        <p className="min-w-0 flex-1 text-neutral-600">
          选择参考图中… 点击画布图片选择（视频参考）
        </p>
        <span className="shrink-0 tabular-nums text-neutral-500">已选 {n} 张</span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-neutral-800 hover:bg-neutral-50"
            onClick={() => cancelCanvasSelection()}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-800"
            onClick={() => commitCanvasSelection()}
          >
            完成 {n} 张
          </button>
        </div>
      </div>
    </div>
  )
}

function RefThumb({ id, onRemove }: { id: string; onRemove: () => void }) {
  const url = useProjectStore((s) => s.imageObjectUrls.get(id))
  return (
    <div className="relative h-12 w-12 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}
      <button
        type="button"
        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-white shadow"
        onClick={onRemove}
        title="移除"
      >
        ✕
      </button>
    </div>
  )
}

export default function VideoGenPanel({
  canvasViewportRef,
}: {
  canvasViewportRef: RefObject<HTMLDivElement | null>
}) {
  const videoGenPanelOpen = useProjectStore((s) => s.videoGenPanelOpen)
  const isCanvasSelectionMode = useProjectStore((s) => s.isCanvasSelectionMode)
  const canvasReferenceTarget = useProjectStore((s) => s.canvasReferenceTarget)
  const videoGenConfig = useProjectStore((s) => s.videoGenConfig)
  const updateVideoGenConfig = useProjectStore((s) => s.updateVideoGenConfig)
  const setVideoGenPanelOpen = useProjectStore((s) => s.setVideoGenPanelOpen)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)

  const [busy, setBusy] = useState(false)
  const [videoRefError, setVideoRefError] = useState<string | null>(null)

  useEffect(() => {
    const allowed = durationsForModel(videoGenConfig.model)
    if (!allowed.includes(videoGenConfig.duration)) {
      updateVideoGenConfig({ duration: defaultDurationForModel(videoGenConfig.model) })
    }
  }, [videoGenConfig.model, videoGenConfig.duration, updateVideoGenConfig])

  useEffect(() => {
    setVideoRefError(null)
  }, [videoGenConfig.referenceImageIds])

  if (isCanvasSelectionMode && canvasReferenceTarget === 'video-gen') {
    return <VideoGenSelectionBar />
  }

  if (!videoGenPanelOpen) return null

  const apiKeyOk = hasApimartApiKey()
  const maxRef = maxRefsForModel(videoGenConfig.model)
  const durationOptions = durationsForModel(videoGenConfig.model)

  function clampRefs(ids: string[]): string[] {
    return ids.slice(0, maxRef)
  }

  function removeRef(id: string): void {
    updateVideoGenConfig({
      referenceImageIds: videoGenConfig.referenceImageIds.filter((x) => x !== id),
    })
  }

  return (
    <div
      data-no-canvas-pan
      className="pointer-events-auto fixed bottom-16 left-1/2 z-[160] w-[min(92vw,760px)] min-w-[min(92vw,600px)] -translate-x-1/2 rounded-lg border border-neutral-200 bg-white font-mono shadow-lg"
    >
      <div className="flex flex-col gap-3 p-4">
        {!apiKeyOk ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            需在 .env.local 设置 VITE_APIMART_API_KEY（视频仅 APIMart）
          </p>
        ) : null}

        {videoRefError ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {videoRefError}
          </p>
        ) : null}

        <p className="text-[10px] leading-snug text-neutral-500">
          图生视频参考须为已同步到 GitHub 的图片（路径 <code className="rounded bg-neutral-100 px-0.5">assets/…</code>
          ）；上传或生成中的图片请等待保存完成后再选作参考。
        </p>

        <div className="flex flex-wrap items-start gap-3">
          <ReferenceImagePicker
            canvasViewportRef={canvasViewportRef}
            selectionTarget="video-gen"
            allowLocalUpload={false}
            onAddReferenceIds={(ids) => {
              const next = clampRefs([
                ...new Set([...videoGenConfig.referenceImageIds, ...ids]),
              ])
              updateVideoGenConfig({ referenceImageIds: next })
            }}
          />
          {videoGenConfig.referenceImageIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-neutral-500">
                {videoGenConfig.referenceImageIds.length}/{maxRef}
              </span>
              {videoGenConfig.referenceImageIds.map((rid) => (
                <RefThumb key={rid} id={rid} onRemove={() => removeRef(rid)} />
              ))}
            </div>
          ) : null}
        </div>

        <textarea
          className="min-h-[6.5rem] w-full resize-y rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          placeholder="描述你想要的视频…"
          value={videoGenConfig.prompt}
          onChange={(e) => updateVideoGenConfig({ prompt: e.target.value })}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-2">
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            API
            <select
              disabled
              className="cursor-not-allowed rounded border border-neutral-200 bg-neutral-100 px-2 py-1.5 text-xs text-neutral-600"
              value="apimart"
            >
              <option value="apimart">APIMart</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-1 items-center gap-1 text-xs text-neutral-600">
            模型
            <select
              className="min-w-0 max-w-full flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={videoGenConfig.model}
              onChange={(e) => {
                const next = e.target.value as APImartVideoModel
                const allowed = durationsForModel(next)
                const nextDur = allowed.includes(videoGenConfig.duration)
                  ? videoGenConfig.duration
                  : defaultDurationForModel(next)
                updateVideoGenConfig({
                  model: next,
                  duration: nextDur,
                  referenceImageIds: clampRefs(videoGenConfig.referenceImageIds),
                })
              }}
            >
              {APIMART_VIDEO_MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-xs text-neutral-600">
            比例
            <select
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={videoGenConfig.ratio}
              onChange={(e) =>
                updateVideoGenConfig({ ratio: e.target.value as VideoGenRatio })
              }
            >
              {VIDEO_RATIOS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-xs text-neutral-600">
            分辨率
            <select
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={videoGenConfig.quality}
              onChange={(e) =>
                updateVideoGenConfig({ quality: e.target.value as VideoQuality })
              }
              title="各模型支持不同档位；不支持的选项会在请求时自动降级（见 console）"
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.value} value={q.value} title={q.title}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-xs text-neutral-600">
            时长（秒）
            <select
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={videoGenConfig.duration}
              onChange={(e) =>
                updateVideoGenConfig({ duration: Number(e.target.value) })
              }
            >
              {durationOptions.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={busy || !apiKeyOk}
            className="ml-auto inline-flex items-center gap-1.5 rounded bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
            onClick={() => {
              const prompt = videoGenConfig.prompt.trim()
              if (!prompt || busy || !apiKeyOk) return
              const refIds = clampRefs(videoGenConfig.referenceImageIds)
              const refErr = validateVideoReferenceIds(refIds)
              if (refErr) {
                setVideoRefError(refErr)
                return
              }
              setVideoRefError(null)
              setVideoGenPanelOpen(false)
              setSelectedTool('cursor')
              setBusy(true)
              void runCanvasVideoGeneration({
                viewportEl: canvasViewportRef.current,
                prompt,
                model: videoGenConfig.model,
                ratio: videoGenConfig.ratio,
                quality: videoGenConfig.quality,
                duration: videoGenConfig.duration,
                referenceImageIds: clampRefs(videoGenConfig.referenceImageIds),
              }).finally(() => setBusy(false))
            }}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Zap className="h-4 w-4" aria-hidden strokeWidth={2} />
            )}
            生成视频
          </button>
        </div>
      </div>
    </div>
  )
}
