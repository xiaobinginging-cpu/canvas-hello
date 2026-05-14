import { Zap, X } from 'lucide-react'
import { useMemo, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { runCanvasPromptGeneration } from '../../lib/canvasPromptGen.ts'
import { hasApiKey, missingApiKeyMessage } from '../../lib/apiKeys.ts'
import {
  GOOGLE_PROMPT_MODEL_OPTIONS,
  KIMI_PROMPT_MODELS,
  DEFAULT_PROMPT_GEN_INSTRUCTION_PLACEHOLDER,
  type PromptGenAPI,
  type PromptGenModel,
} from '../../lib/promptGen.ts'
import { useProjectStore } from '../../store/useStore.ts'
import { GEN_PANEL_GENERATE_BTN_CLASS } from './genPanelStyles.ts'
import ReferenceImagePicker from './ReferenceImagePicker.tsx'
import ReferenceImageThumb from './ReferenceImageThumb.tsx'
import ReferenceSelectionBar from './ReferenceSelectionBar.tsx'

export default function PromptGenPanel({
  canvasViewportRef,
}: {
  canvasViewportRef: RefObject<HTMLDivElement | null>
}) {
  const selectedTool = useProjectStore((s) => s.selectedTool)
  const isCanvasSelectionMode = useProjectStore((s) => s.isCanvasSelectionMode)
  const canvasReferenceTarget = useProjectStore((s) => s.canvasReferenceTarget)
  const promptGenConfig = useProjectStore((s) => s.promptGenConfig)
  const updatePromptGenConfig = useProjectStore((s) => s.updatePromptGenConfig)
  const promptGenImageIds = useProjectStore((s) => s.promptGenImageIds)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)
  const clearPromptGenImageIds = useProjectStore((s) => s.clearPromptGenImageIds)

  const open = selectedTool === 'prompt-gen'

  const modelsForApi = useMemo((): readonly { value: PromptGenModel; label: string }[] => {
    if (promptGenConfig.api === 'google') return [...GOOGLE_PROMPT_MODEL_OPTIONS]
    return KIMI_PROMPT_MODELS.map((value) => ({ value, label: value }))
  }, [promptGenConfig.api])

  const apiKeyOk =
    promptGenConfig.api === 'google' ? hasApiKey('google') : hasApiKey('kimi')

  const hasReferenceImages = promptGenImageIds.length > 0
  const hasInstruction = promptGenConfig.instruction.trim() !== ''
  const canGenerate = apiKeyOk && (hasReferenceImages || hasInstruction)

  if (isCanvasSelectionMode && canvasReferenceTarget === 'prompt-gen') {
    return <ReferenceSelectionBar context="prompt-gen" />
  }

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
          <Link
            to="/settings"
            className="block rounded-lg border border-[#c9b8bb] bg-[#faf6f7] px-3 py-2 text-xs text-neutral-800 underline decoration-[#5f7163]/50 decoration-2 underline-offset-2 hover:decoration-[#5f7163]"
          >
            {missingApiKeyMessage(promptGenConfig.api === 'google' ? 'google' : 'kimi')}
          </Link>
        ) : null}

        <div className="flex flex-wrap items-start gap-3">
          <ReferenceImagePicker
            canvasViewportRef={canvasViewportRef}
            selectionTarget="prompt-gen"
            onAddReferenceIds={(ids) => {
              const cur = useProjectStore.getState().promptGenImageIds
              const next = [...new Set([...cur, ...ids])]
              useProjectStore.setState({ promptGenImageIds: next })
            }}
          />
          {promptGenImageIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {promptGenImageIds.map((id) => (
                <ReferenceImageThumb key={id} id={id} onRemove={() => removeThumb(id)} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-neutral-100 pt-2">
          <label className="block text-xs text-neutral-600">
            自定义 instruction（可选）
            <textarea
              className="mt-1 min-h-[2.75rem] w-full resize-y rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
              placeholder={DEFAULT_PROMPT_GEN_INSTRUCTION_PLACEHOLDER}
              value={promptGenConfig.instruction}
              onChange={(e) => updatePromptGenConfig({ instruction: e.target.value })}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-neutral-600">
              API
              <select
                className="min-w-[120px] rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900"
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
              模型
              <select
                className="min-w-[min(100%,160px)] max-w-full flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 sm:min-w-[160px]"
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
              className={GEN_PANEL_GENERATE_BTN_CLASS}
              onClick={() => {
                if (!canGenerate) return
                const instr = promptGenConfig.instruction.trim()
                const imageIds = [...promptGenImageIds]
                const api = promptGenConfig.api
                const model = promptGenConfig.model
                setSelectedTool('cursor')
                clearPromptGenImageIds()
                void runCanvasPromptGeneration({
                  api,
                  model,
                  imageIds,
                  instruction: instr ? instr : undefined,
                })
              }}
            >
              <Zap className="h-4 w-4" aria-hidden strokeWidth={2} />
              生成
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
