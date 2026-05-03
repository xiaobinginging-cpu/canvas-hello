import { Loader2, Zap } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import {
  APIMART_IMAGE_MODEL_OPTIONS,
  coerceApimartModelId,
  DEFAULT_APIMART_MODEL,
  hasApimartApiKey,
} from '../../lib/apimartGen.ts'
import { hasGoogleApiKey } from '../../lib/ai.ts'
import { runCanvasImageGeneration } from '../../lib/canvasGeneration.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { ImageGenRatio, ImageGenResolution } from '../../store/useStore.ts'
import ReferenceImagePicker from './ReferenceImagePicker.tsx'

const RATIOS: { value: ImageGenRatio; label: string }[] = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
  { value: '21:9', label: '21:9' },
]

const RESOLUTIONS: { value: ImageGenResolution; label: string }[] = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const COUNTS = [1, 2, 4] as const

const GOOGLE_MODELS: { value: string; label: string }[] = [
  {
    value: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
  },
  {
    value: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
  },
]

function ImageGenSelectionBar() {
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
          选择参考图中… 点击画布图片选择
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

export default function ImageGenPanel({
  canvasViewportRef,
}: {
  canvasViewportRef: RefObject<HTMLDivElement | null>
}) {
  const imageGenPanelOpen = useProjectStore((s) => s.imageGenPanelOpen)
  const isCanvasSelectionMode = useProjectStore((s) => s.isCanvasSelectionMode)
  const canvasReferenceTarget = useProjectStore((s) => s.canvasReferenceTarget)
  const imageGenConfig = useProjectStore((s) => s.imageGenConfig)
  const updateImageGenConfig = useProjectStore((s) => s.updateImageGenConfig)
  const setImageGenPanelOpen = useProjectStore((s) => s.setImageGenPanelOpen)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)

  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (imageGenConfig.api !== 'apimart') return
    const coerced = coerceApimartModelId(imageGenConfig.model)
    if (coerced !== imageGenConfig.model) {
      updateImageGenConfig({ model: coerced })
    }
  }, [imageGenConfig.api, imageGenConfig.model, updateImageGenConfig])

  const refTarget = canvasReferenceTarget ?? 'image-gen'
  if (isCanvasSelectionMode && refTarget === 'image-gen') {
    return <ImageGenSelectionBar />
  }

  if (!imageGenPanelOpen) return null

  const apiKeyOk =
    imageGenConfig.api === 'google'
      ? hasGoogleApiKey()
      : hasApimartApiKey()

  function removeRef(id: string): void {
    updateImageGenConfig({
      referenceImageIds: imageGenConfig.referenceImageIds.filter((x) => x !== id),
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
            {imageGenConfig.api === 'apimart'
              ? '需在 .env.local 设置 VITE_APIMART_API_KEY'
              : '需在 .env.local 设置 VITE_GOOGLE_API_KEY'}
          </p>
        ) : null}

        <div className="flex flex-wrap items-start gap-3">
          <ReferenceImagePicker
            canvasViewportRef={canvasViewportRef}
            onAddReferenceIds={(ids) => {
              const next = [...new Set([...imageGenConfig.referenceImageIds, ...ids])]
              updateImageGenConfig({ referenceImageIds: next })
            }}
          />
          {imageGenConfig.referenceImageIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {imageGenConfig.referenceImageIds.map((rid) => (
                <RefThumb key={rid} id={rid} onRemove={() => removeRef(rid)} />
              ))}
            </div>
          ) : null}
        </div>

        <textarea
          className="min-h-[6.5rem] w-full resize-y rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          placeholder="描述你想要的图…"
          value={imageGenConfig.prompt}
          onChange={(e) => updateImageGenConfig({ prompt: e.target.value })}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-2">
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            比例
            <select
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={imageGenConfig.ratio}
              onChange={(e) =>
                updateImageGenConfig({ ratio: e.target.value as ImageGenRatio })
              }
            >
              {RATIOS.map((r) => (
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
              value={imageGenConfig.resolution}
              onChange={(e) =>
                updateImageGenConfig({
                  resolution: e.target.value as ImageGenResolution,
                })
              }
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-xs text-neutral-600">
            数量
            <select
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={imageGenConfig.count}
              onChange={(e) =>
                updateImageGenConfig({ count: Number(e.target.value) as 1 | 2 | 4 })
              }
            >
              {COUNTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-xs text-neutral-600">
            API
            <select
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={imageGenConfig.api}
              onChange={(e) => {
                const nextApi = e.target.value as 'google' | 'apimart'
                if (nextApi === 'apimart') {
                  updateImageGenConfig({
                    api: 'apimart',
                    model: DEFAULT_APIMART_MODEL,
                  })
                } else {
                  const nextModel = GOOGLE_MODELS.some((m) => m.value === imageGenConfig.model)
                    ? imageGenConfig.model
                    : GOOGLE_MODELS[0].value
                  updateImageGenConfig({ api: 'google', model: nextModel })
                }
              }}
            >
              <option value="google">Google</option>
              <option value="apimart">APIMart</option>
              <option value="kimi" disabled title="Kimi 仅用于提示词生成">
                Kimi
              </option>
            </select>
          </label>

          <label className="flex min-w-0 flex-1 items-center gap-1 text-xs text-neutral-600">
            模型
            <select
              className="min-w-0 max-w-full flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={
                imageGenConfig.api === 'apimart'
                  ? coerceApimartModelId(imageGenConfig.model)
                  : imageGenConfig.model
              }
              onChange={(e) => updateImageGenConfig({ model: e.target.value })}
            >
              {(imageGenConfig.api === 'apimart' ? APIMART_IMAGE_MODEL_OPTIONS : GOOGLE_MODELS).map(
                (m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <button
            type="button"
            disabled={busy || !apiKeyOk}
            className="ml-auto inline-flex items-center gap-1.5 rounded bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
            onClick={() => {
              const prompt = imageGenConfig.prompt.trim()
              if (!prompt || busy || !apiKeyOk) return
              setImageGenPanelOpen(false)
              setSelectedTool('cursor')
              setBusy(true)
              void runCanvasImageGeneration({
                viewportEl: canvasViewportRef.current,
                prompt,
                model:
                  imageGenConfig.api === 'apimart'
                    ? coerceApimartModelId(imageGenConfig.model)
                    : imageGenConfig.model,
                ratio: imageGenConfig.ratio,
                resolution: imageGenConfig.resolution,
                count: imageGenConfig.count,
                referenceImageIds: imageGenConfig.referenceImageIds,
                api: imageGenConfig.api,
              }).finally(() => setBusy(false))
            }}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Zap className="h-4 w-4" aria-hidden strokeWidth={2} />
            )}
            生成
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
