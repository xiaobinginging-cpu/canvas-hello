import { Clipboard, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { deleteTextCardFromCanvas } from '../../lib/canvasUpload.ts'
import { schedulePersistCanvas } from '../../lib/canvasPersist.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { TextCard } from '../../types/project.ts'

const MIN_W = 200
const MIN_H = 100
const MAX_W = 1400
const MAX_H = 900

const PLACEHOLDER = '点击输入文本...'

export default function TextCardItem({ card }: { card: TextCard }) {
  const projectId = useProjectStore((s) => s.currentProjectId)
  const selectedTextCardId = useProjectStore((s) => s.selectedTextCardId)
  const canvasScale = useProjectStore((s) => s.canvasScale)
  const patchTextCard = useProjectStore((s) => s.patchTextCard)
  const setSelectedTextCardId = useProjectStore((s) => s.setSelectedTextCardId)
  const pendingTextCardEditId = useProjectStore((s) => s.pendingTextCardEditId)
  const setPendingTextCardEditId = useProjectStore((s) => s.setPendingTextCardEditId)
  const selectedTool = useProjectStore((s) => s.selectedTool)
  const setSelectedTool = useProjectStore((s) => s.setSelectedTool)

  const selected = selectedTextCardId === card.id
  const invCanvas = 1 / canvasScale

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(card.text)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const textScrollRef = useRef<HTMLDivElement>(null)
  const savingRef = useRef(false)
  const exitEditModeRef = useRef<() => void>(() => {})

  useEffect(() => {
    setDraft(card.text)
  }, [card.text])

  useEffect(() => {
    if (pendingTextCardEditId !== card.id) return
    console.log(`[text-card] entered edit mode id=${card.id}`)
    setIsEditing(true)
    setDraft(card.text)
    setPendingTextCardEditId(null)
  }, [pendingTextCardEditId, card.id, card.text, setPendingTextCardEditId])

  useEffect(() => {
    if (!isEditing) return
    const t = window.setTimeout(() => taRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [isEditing])

  const persistSoon = useCallback(() => {
    if (projectId) schedulePersistCanvas(projectId, 500)
  }, [projectId])

  const exitEditMode = useCallback(() => {
    if (savingRef.current) return
    savingRef.current = true
    patchTextCard(card.id, { text: draft })
    console.log(`[text-card] saved id=${card.id} length=${draft.length}`)
    setIsEditing(false)
    persistSoon()
    if (selectedTool === 'text-card') {
      setSelectedTool('cursor')
    }
    window.setTimeout(() => {
      savingRef.current = false
    }, 0)
  }, [draft, card.id, patchTextCard, persistSoon, selectedTool, setSelectedTool])

  exitEditModeRef.current = exitEditMode

  const beginEditFromDoubleClick = useCallback(() => {
    console.log(`[text-card] entered edit mode id=${card.id}`)
    setIsEditing(true)
    setDraft(card.text)
  }, [card.id, card.text])

  useEffect(() => {
    if (!isEditing) return
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        exitEditModeRef.current()
      }
    }
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }, [isEditing])

  const onCopy = useCallback(() => {
    const t = card.text.trim() ? card.text : ''
    void navigator.clipboard.writeText(t).catch(() => {
      /* ignore */
    })
  }, [card.text])

  const cardBorderCls = isEditing
    ? 'border border-dashed border-[#888888]'
    : selected
      ? 'border border-solid border-[#888888]'
      : 'border border-solid border-[#E5E5E5]'

  return (
    <Rnd
      scale={canvasScale}
      cancel=".no-rnd-drag"
      disableDragging={isEditing}
      enableResizing={!isEditing}
      minWidth={MIN_W}
      minHeight={MIN_H}
      maxWidth={MAX_W}
      maxHeight={MAX_H}
      size={{ width: card.width, height: card.height }}
      position={{ x: card.x, y: card.y }}
      className="!pointer-events-auto"
      style={{
        zIndex: isEditing || selected ? 22 : 15,
      }}
      onDragStop={(_e, d) => {
        document.body.style.cursor = ''
        patchTextCard(card.id, { x: d.x, y: d.y })
        persistSoon()
      }}
      onDragStart={() => {
        document.body.style.cursor = 'grabbing'
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        patchTextCard(card.id, {
          x: pos.x,
          y: pos.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        })
        persistSoon()
      }}
    >
      <div
        data-text-card-item
        className="flex h-full w-full min-h-0 cursor-move flex-col"
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            className="absolute left-0 z-[2]"
            style={{
              bottom: '100%',
              marginBottom: 4,
            }}
          >
            <div className="relative">
              <div
                className="pointer-events-none inline-flex items-center gap-1 px-0.5 font-mono text-[11px] text-neutral-500 select-none"
                style={{
                  transform: `scale(${invCanvas})`,
                  transformOrigin: 'bottom left',
                }}
              >
                <span aria-hidden>≡</span>
                <span>Text</span>
              </div>
              {!isEditing ? (
                <div
                  className="absolute inset-0 z-[1] cursor-move"
                  aria-hidden
                  onMouseDown={() => setSelectedTextCardId(card.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    beginEditFromDoubleClick()
                  }}
                />
              ) : null}
            </div>
          </div>

          <div
            className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[#FAFAFA] font-mono shadow-[0_1px_3px_rgba(0,0,0,0.06)] ${cardBorderCls}`}
          >
          {selected && !isEditing ? (
            <div
              className="no-rnd-drag absolute right-2 top-2 z-20 flex gap-1"
              style={{ transform: `scale(${invCanvas})`, transformOrigin: 'top right' }}
            >
              <button
                type="button"
                title="复制"
                className="flex h-7 w-7 items-center justify-center rounded border border-[#E5E5E5] bg-[#FAFAFA] text-neutral-800 hover:bg-white"
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy()
                }}
              >
                <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                title="删除"
                className="flex h-7 w-7 items-center justify-center rounded border border-[#E5E5E5] bg-[#FAFAFA] text-neutral-800 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteTextCardFromCanvas(card.id)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ) : null}

          {isEditing ? (
            <div className="no-rnd-drag flex min-h-0 flex-1 flex-col px-8 py-6">
              <textarea
                ref={taRef}
                data-text-card-editor="true"
                className="min-h-0 w-full flex-1 resize-none border-0 bg-transparent p-0 font-mono text-[20px] leading-[1.7] text-[#1a1a1a] outline-none focus:ring-0"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    exitEditMode()
                  }
                }}
                onBlur={() => {
                  exitEditMode()
                }}
              />
            </div>
          ) : (
            <>
              <div
                className="absolute inset-0 z-[1] cursor-move"
                aria-hidden
                onMouseDown={() => setSelectedTextCardId(card.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  beginEditFromDoubleClick()
                }}
                onWheel={(e) => {
                  const el = textScrollRef.current
                  if (!el) return
                  el.scrollTop += e.deltaY
                  e.preventDefault()
                }}
              />
              <div
                ref={textScrollRef}
                className="absolute inset-0 z-0 overflow-auto px-8 py-6 font-mono text-[20px] leading-[1.7] text-[#1a1a1a] pointer-events-none select-none whitespace-pre-wrap break-words"
              >
                {card.text.trim() ? (
                  card.text
                ) : (
                  <span className="text-neutral-400">{PLACEHOLDER}</span>
                )}
              </div>
            </>
          )}
          </div>
        </div>
      </div>
    </Rnd>
  )
}
