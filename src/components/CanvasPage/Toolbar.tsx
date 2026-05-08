import { useEffect, useRef, useState, type RefObject } from 'react'
import { Clapperboard, Hand, ImagePlus, Type, Upload, Wand2 } from 'lucide-react'
import { createManualTextCardAtViewportCenter } from '../../lib/createManualTextCard.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { CanvasSelectedTool } from '../../store/useStore.ts'

export default function Toolbar({
  onPickImageFiles,
  canvasViewportRef,
}: {
  /** @deprecated 保留与 CanvasPage 的 props 兼容；当前未使用。 */
  onToast?: (message: string) => void
  onPickImageFiles: () => void
  canvasViewportRef: RefObject<HTMLDivElement | null>
}) {
  const selectedTool = useProjectStore((s) => s.selectedTool)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)
  const setImageGenPanelOpen = useProjectStore((s) => s.setImageGenPanelOpen)
  const setVideoGenPanelOpen = useProjectStore((s) => s.setVideoGenPanelOpen)
  const updateImageGenConfig = useProjectStore((s) => s.updateImageGenConfig)
  const resetVideoGenConfig = useProjectStore((s) => s.resetVideoGenConfig)
  const cancelCanvasSelection = useProjectStore((s) => s.cancelCanvasSelection)
  const clearPromptGenImageIds = useProjectStore((s) => s.clearPromptGenImageIds)
  const setPendingTextCardEditId = useProjectStore((s) => s.setPendingTextCardEditId)
  const [uploadOpen, setUploadOpen] = useState(false)
  const uploadWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!uploadWrapRef.current?.contains(e.target as Node)) setUploadOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function selectTool(id: CanvasSelectedTool): void {
    setSelectedTool(id)
    if (id !== 'upload') setUploadOpen(false)
    if (id !== 'image-gen') {
      setImageGenPanelOpen(false)
      cancelCanvasSelection()
    }
    if (id !== 'video-gen') {
      setVideoGenPanelOpen(false)
    }
    if (id !== 'prompt-gen') {
      clearPromptGenImageIds()
    }
    if (id !== 'text-card') {
      setPendingTextCardEditId(null)
    }
  }

  function toolClass(active: boolean, disabled?: boolean): string {
    const base =
      'rounded px-3 py-2 text-lg transition-colors font-mono leading-none min-w-[2.5rem] inline-flex items-center justify-center'
    if (disabled) return `${base} cursor-not-allowed text-neutral-300`
    if (active) return `${base} bg-neutral-200 text-neutral-900 ring-1 ring-neutral-400`
    return `${base} text-neutral-800 hover:bg-neutral-200/80`
  }

  return (
    <footer className="relative flex shrink-0 items-center border-t border-neutral-200 bg-[#FAF8F5] px-4 py-2 font-mono">
      <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
        <button
          type="button"
          title="选择"
          aria-pressed={selectedTool === 'cursor'}
          className={toolClass(selectedTool === 'cursor')}
          onClick={() => {
            selectTool('cursor')
            console.log('TODO: select tool (cursor)')
          }}
        >
          <Hand size={20} strokeWidth={2} color="#222" />
        </button>

        <div ref={uploadWrapRef} className="relative inline-flex">
          <button
            type="button"
            title="上传"
            aria-pressed={selectedTool === 'upload'}
            className={toolClass(selectedTool === 'upload')}
            onClick={() => {
              selectTool('upload')
              setUploadOpen((o) => !o)
            }}
          >
            <Upload size={20} strokeWidth={2} color="#222" />
          </button>
          {uploadOpen ? (
            <div
              role="menu"
              className="absolute bottom-full left-0 z-[120] mb-1 min-w-[10rem] rounded border border-neutral-200 bg-white py-1 text-left shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-neutral-900 hover:bg-neutral-100"
                onClick={() => {
                  setUploadOpen(false)
                  onPickImageFiles()
                }}
              >
                图片
              </button>
              <button
                type="button"
                role="menuitem"
                disabled
                title="即将推出"
                className="block w-full cursor-not-allowed px-3 py-2 text-left text-xs text-neutral-400"
              >
                视频
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          title="新建文本"
          aria-pressed={selectedTool === 'text-card'}
          className={toolClass(selectedTool === 'text-card')}
          onClick={() => {
            setImageGenPanelOpen(false)
            setVideoGenPanelOpen(false)
            cancelCanvasSelection()
            clearPromptGenImageIds()
            setSelectedTool('text-card')
            createManualTextCardAtViewportCenter(canvasViewportRef.current)
          }}
        >
          <Type size={20} strokeWidth={2} color="#222" />
        </button>

        <button
          type="button"
          title="提示词生成器"
          aria-pressed={selectedTool === 'prompt-gen'}
          className={toolClass(selectedTool === 'prompt-gen')}
          onClick={() => {
            setImageGenPanelOpen(false)
            setVideoGenPanelOpen(false)
            cancelCanvasSelection()
            if (selectedTool === 'prompt-gen') {
              selectTool('cursor')
            } else {
              setSelectedTool('prompt-gen')
            }
          }}
        >
          <Wand2 size={20} strokeWidth={2} color="#222" />
        </button>

        <button
          type="button"
          title="图像生成器"
          aria-pressed={selectedTool === 'image-gen'}
          className={toolClass(selectedTool === 'image-gen')}
          onClick={() => {
            clearPromptGenImageIds()
            setVideoGenPanelOpen(false)
            setSelectedTool('image-gen')
            setImageGenPanelOpen((prev) => {
              const next = !prev
              if (next) {
                updateImageGenConfig({ prompt: '', referenceImageIds: [] })
                cancelCanvasSelection()
              }
              return next
            })
          }}
        >
          <ImagePlus size={20} strokeWidth={2} color="#222" />
        </button>

        <button
          type="button"
          title="视频生成器"
          aria-pressed={selectedTool === 'video-gen'}
          className={toolClass(selectedTool === 'video-gen')}
          onClick={() => {
            clearPromptGenImageIds()
            setImageGenPanelOpen(false)
            setSelectedTool('video-gen')
            setVideoGenPanelOpen((prev) => {
              const next = !prev
              if (next) {
                resetVideoGenConfig()
                cancelCanvasSelection()
              }
              return next
            })
          }}
        >
          <Clapperboard size={20} strokeWidth={2} color="#222" />
        </button>
      </div>
    </footer>
  )
}
