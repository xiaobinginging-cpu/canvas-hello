import { useProjectStore } from '../../store/useStore.ts'

const HINT: Record<'image-gen' | 'video-gen' | 'prompt-gen', string> = {
  'image-gen': '选择参考图中… 点击画布图片选择',
  'video-gen': '选择参考图中… 点击画布图片选择（视频参考）',
  'prompt-gen': '选择参考图中… 点击画布图片选择（提示词）',
}

/** 图生 / 视频 / 提示词 —— 从画布多选参考图时的底部条（共用）。 */
export default function ReferenceSelectionBar({
  context,
}: {
  context: 'image-gen' | 'video-gen' | 'prompt-gen'
}) {
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
        <p className="min-w-0 flex-1 text-neutral-600">{HINT[context]}</p>
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
