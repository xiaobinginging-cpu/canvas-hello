import { Loader2, Zap } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  APIMART_IMAGE_MODEL_OPTIONS,
  coerceApimartModelId,
  DEFAULT_APIMART_MODEL,
} from '../../lib/apimartGen.ts'
import { hasApiKey, missingApiKeyMessage } from '../../lib/apiKeys.ts'
import { runCanvasImageGeneration } from '../../lib/canvasGeneration.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { ImageGenRatio, ImageGenResolution } from '../../store/useStore.ts'
import { GEN_PANEL_GENERATE_BTN_CLASS } from './genPanelStyles.ts'
import ReferenceImagePicker from './ReferenceImagePicker.tsx'
import ReferenceImageThumb from './ReferenceImageThumb.tsx'
import ReferenceSelectionBar from './ReferenceSelectionBar.tsx'

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
    return <ReferenceSelectionBar context="image-gen" />
  }

  if (!imageGenPanelOpen) return null

  const promptHasContent = imageGenConfig.prompt.trim() !== ''
  const apiKeyOk =
    imageGenConfig.api === 'google' ? hasApiKey('google') : hasApiKey('apimart')
  /** MJ 固定出 1 张 2×2 网格图，数量/分辨率参数不适用（比例经 --ar 生效）。 */
  const isMJ =
    imageGenConfig.api === 'apimart' &&
    coerceApimartModelId(imageGenConfig.model) === 'midjourney'

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
          <Link
            to="/settings"
            className="block rounded-lg border border-[#c9b8bb] bg-[#faf6f7] px-3 py-2 text-xs text-neutral-800 underline decoration-[#5f7163]/50 decoration-2 underline-offset-2 hover:decoration-[#5f7163]"
          >
            {missingApiKeyMessage(imageGenConfig.api === 'apimart' ? 'apimart' : 'google')}
          </Link>
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
                <ReferenceImageThumb key={rid} id={rid} onRemove={() => removeRef(rid)} />
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

        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-neutral-600">
              比例
              <select
                className="min-w-[120px] rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
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
                className="min-w-[120px] rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMJ}
                title={isMJ ? 'Midjourney 不支持分辨率档位' : undefined}
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
                className="min-w-[120px] rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMJ}
                title={isMJ ? 'Midjourney 固定一次出 1 张 2×2 网格图，可在图上 U1-U4 放大' : undefined}
                value={isMJ ? 1 : imageGenConfig.count}
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-neutral-600">
              API
              <select
                className="min-w-[120px] rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
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
                className="min-w-[min(100%,160px)] max-w-full flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 sm:min-w-[160px]"
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
              disabled={busy || !apiKeyOk || !promptHasContent}
              className={GEN_PANEL_GENERATE_BTN_CLASS}
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
    </div>
  )
}
