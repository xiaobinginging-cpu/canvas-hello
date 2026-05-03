import { Loader2, Zap, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { hasGoogleApiKey } from '../../lib/ai.ts'
import { runCanvasPromptGeneration } from '../../lib/canvasPromptGen.ts'
import {
  GOOGLE_PROMPT_MODEL_OPTIONS,
  KIMI_PROMPT_MODELS,
  DEFAULT_PROMPT_GEN_INSTRUCTION_PLACEHOLDER,
  hasKimiApiKey,
  type PromptGenAPI,
  type PromptGenModel,
} from '../../lib/promptGen.ts'
import { useProjectStore } from '../../store/useStore.ts'

export default function PromptGenPanel() {
  const selectedTool = useProjectStore((s) => s.selectedTool)
  const promptGenConfig = useProjectStore((s) => s.promptGenConfig)
  const updatePromptGenConfig = useProjectStore((s) => s.updatePromptGenConfig)
  const promptGenImageIds = useProjectStore((s) => s.promptGenImageIds)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)
  const clearPromptGenImageIds = useProjectStore((s) => s.clearPromptGenImageIds)

  const [busy, setBusy] = useState(false)

  const open = selectedTool === 'prompt-gen'

  const modelsForApi = useMemo((): readonly { value: PromptGenModel; label: string }[] => {
    if (promptGenConfig.api === 'google') return [...GOOGLE_PROMPT_MODEL_OPTIONS]
    return KIMI_PROMPT_MODELS.map((value) => ({ value, label: value }))
  }, [promptGenConfig.api])

  const apiKeyOk =
    promptGenConfig.api === 'google' ? hasGoogleApiKey() : hasKimiApiKey()

  const canGenerate =
    promptGenImageIds.length > 0 && apiKeyOk && !busy

  if (!open) return null

  function removeThumb(id: string): void {
    useProjectStore.getState().togglePromptGenImageId(id)
  }

  function closePanel(): void {
    setSelectedTool('cursor')
    clearPromptGenImageIds()
  }

  return (
    <div
      data-no-canvas-pan
      className="pointer-events-auto fixed bottom-16 left-1/2 z-[160] w-[min(92vw,760px)] min-w-[min(92vw,600px)] -translate-x-1/2 rounded-lg border border-neutral-200 bg-white font-mono shadow-lg"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-medium text-neutral-900">📝→ 提示词生成器</h2>
          <button
            type="button"
            title="关闭"
            className="no-rnd-drag rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
            onClick={closePanel}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {!apiKeyOk ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {promptGenConfig.api === 'google'
              ? '需在 .env.local 设置 VITE_GOOGLE_API_KEY'
              : '需在 .env.local 设置 VITE_KIMI_API_KEY'}
          </p>
        ) : null}

        <div className="flex min-h-[3.25rem] flex-wrap items-start gap-2">
          {promptGenImageIds.length === 0 ? (
            <p className="text-xs text-neutral-500">请在画布选择图片…</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {promptGenImageIds.map((id) => (
                <RefThumb key={id} id={id} onRemove={() => removeThumb(id)} />
              ))}
            </div>
          )}
        </div>

        <label className="block text-xs text-neutral-600">
          自定义 instruction（可选）
          <textarea
            className="mt-1 min-h-[5rem] w-full resize-y rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
            placeholder={DEFAULT_PROMPT_GEN_INSTRUCTION_PLACEHOLDER}
            value={promptGenConfig.instruction}
            onChange={(e) => updatePromptGenConfig({ instruction: e.target.value })}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-2">
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            API
            <select
              className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={promptGenConfig.api}
              onChange={(e) => {
                const api = e.target.value as PromptGenAPI
                const nextValues =
                  api === 'google'
                    ? GOOGLE_PROMPT_MODEL_OPTIONS.map((o) => o.value)
                    : [...KIMI_PROMPT_MODELS]
                const model = nextValues.includes(promptGenConfig.model as PromptGenModel)
                  ? (promptGenConfig.model as PromptGenModel)
                  : nextValues[0]
                updatePromptGenConfig({ api, model })
              }}
            >
              <option value="google">Google</option>
              <option value="kimi">Kimi</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-1 items-center gap-1 text-xs text-neutral-600">
            Model
            <select
              className="min-w-0 max-w-full flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
              value={promptGenConfig.model}
              onChange={(e) =>
                updatePromptGenConfig({ model: e.target.value as PromptGenModel })
              }
            >
              {modelsForApi.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={!canGenerate}
            className="ml-auto inline-flex items-center gap-1.5 rounded bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
            onClick={() => {
              if (!canGenerate) return
              const instr = promptGenConfig.instruction.trim()
              setBusy(true)
              void runCanvasPromptGeneration({
                api: promptGenConfig.api,
                model: promptGenConfig.model,
                imageIds: [...promptGenImageIds],
                instruction: instr ? instr : undefined,
              })
                .catch(() => {
                  /* logged in lib */
                })
                .finally(() => setBusy(false))
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
