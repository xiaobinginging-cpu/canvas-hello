import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Clipboard,
  Trash2,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const FONT_PRESETS = [12, 14, 16, 18, 20, 24, 32, 48, 60, 72] as const

const COLOR_PRESETS = [
  { label: '黑', value: '#1a1a1a' },
  { label: '灰', value: '#737373' },
  { label: '红', value: '#dc2626' },
  { label: '蓝', value: '#2563eb' },
  { label: '绿', value: '#16a34a' },
] as const

function isProbablyHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s.trim())
}

/** Minimal strip for read-only render + clipboard (no new deps). */
function sanitizeHtmlFragment(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
  /* Ghost line spacing: WebKit leaves px/rem line-heights on spans/blocks after huge font-size edits. */
  out = out.replace(/line-height\s*:\s*[\d.]+\s*px\s*;?/gi, '')
  out = out.replace(/line-height\s*:\s*[\d.]+\s*rem\s*;?/gi, '')
  out = out.replace(/min-height\s*:\s*[\d.]+\s*px\s*;?/gi, '')
  return out
}

function htmlToPlainText(html: string): string {
  if (typeof document === 'undefined') return html
  const d = document.createElement('div')
  d.innerHTML = sanitizeHtmlFragment(html)
  return d.innerText || ''
}

function normalizeEditableHtml(html: string): string {
  const stripped = html.replace(/\u00a0/g, ' ').trim()
  const compact = stripped.replace(/\s+/g, '')
  if (compact === '' || compact === '<br>' || compact === '<div><br></div>' || compact === '<br/>')
    return ''
  return html
}

/** Infer fallback px from persisted HTML when baseFontSizePx is absent (old cards). */
function guessMaxFontSizePxFromHtml(html: string): number {
  const re = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/gi
  let m
  let max = 0
  while ((m = re.exec(html)) !== null) {
    max = Math.max(max, parseFloat(m[1]))
  }
  return max > 0 ? Math.round(max) : 16
}

function rangeInsideEditor(range: Range, editorEl: HTMLElement): boolean {
  return editorEl.contains(range.commonAncestorContainer)
}

function snapshotSelectionInEditor(editorEl: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  if (!rangeInsideEditor(r, editorEl)) return null
  return r.cloneRange()
}

/**
 * Remove px/rem lh/fs from descendants; never strip root `font-size` (controlled by React inline style).
 */
function stripGhostInlineSizing(el: HTMLElement, options?: { isEditorRoot?: boolean }): void {
  const st = el.style
  const isRoot = options?.isEditorRoot === true
  const lh = st.lineHeight
  if (lh && (/px/i.test(lh) || /rem/i.test(lh))) {
    st.removeProperty('line-height')
  }
  if (!isRoot) {
    const fs = st.fontSize
    if (fs && (/px/i.test(fs) || /rem/i.test(fs))) {
      st.removeProperty('font-size')
    }
  }
  const mh = st.minHeight
  if (mh && (/px/i.test(mh) || /rem/i.test(mh))) {
    st.minHeight = ''
  }
  const h = st.height
  if (h && (/px/i.test(h) || /rem/i.test(h)) && el.tagName !== 'IMG') {
    st.removeProperty('height')
  }
  const tag = el.tagName
  if (tag === 'DIV' || tag === 'P') {
    if (!isRoot && st.fontSize) st.removeProperty('font-size')
    st.marginTop = '0'
    st.marginBottom = '0'
    if (st.lineHeight) st.removeProperty('line-height')
  }
}

function stripGhostInlineSizingDeep(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('*').forEach((node) => stripGhostInlineSizing(node))
  stripGhostInlineSizing(root, { isEditorRoot: true })
}

/** Persist/save pass — same as live strip (execCommand may re-introduce px lh/fs between ticks). */
function normalizeEditorLineLayout(editorEl: HTMLElement): void {
  stripGhostInlineSizingDeep(editorEl)
}

function execAlign(which: 'left' | 'center' | 'right'): void {
  try {
    document.execCommand('styleWithCSS', false, 'true')
  } catch {
    /* ignore */
  }
  const cmd =
    which === 'left' ? 'justifyLeft' : which === 'center' ? 'justifyCenter' : 'justifyRight'
  document.execCommand(cmd, false)
}

function TextCardItem({ card }: { card: TextCard }) {
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

  const resolvedDisplayPx = useMemo(() => {
    const v = card.baseFontSizePx ?? guessMaxFontSizePxFromHtml(card.text ?? '')
    return v > 0 ? v : 16
  }, [card.baseFontSizePx, card.text])

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(card.text)
  const editorRef = useRef<HTMLDivElement>(null)
  const textScrollRef = useRef<HTMLDivElement>(null)
  const savingRef = useRef(false)
  const exitEditModeRef = useRef<() => void>(() => {})
  const prevEditingRef = useRef(false)
  /** Last selection inside the editor — toolbar interaction may clear live selection. */
  const savedEditorRangeRef = useRef<Range | null>(null)
  const fontSizeMenuRef = useRef<HTMLDivElement>(null)
  const [fontSizeMenuOpen, setFontSizeMenuOpen] = useState(false)
  /** Card-wide base font size (toolbar); persisted as baseFontSizePx. */
  const [fontSizeLabelPx, setFontSizeLabelPx] = useState(16)

  useEffect(() => {
    setDraft(card.text)
  }, [card.text])

  /** When not editing, keep toolbar/display size aligned with saved card + legacy HTML. */
  useEffect(() => {
    if (!isEditing) {
      const px = card.baseFontSizePx ?? guessMaxFontSizePxFromHtml(card.text ?? '')
      setFontSizeLabelPx(px > 0 ? px : 16)
    }
  }, [card.baseFontSizePx, card.text, isEditing])

  useEffect(() => {
    if (pendingTextCardEditId !== card.id) return
    console.log(`[text-card] entered edit mode id=${card.id}`)
    setIsEditing(true)
    setDraft(card.text)
    setPendingTextCardEditId(null)
  }, [pendingTextCardEditId, card.id, card.text, setPendingTextCardEditId])

  /** One-time hydrate contenteditable when entering edit mode. */
  useEffect(() => {
    const el = editorRef.current
    const turnedOn = isEditing && !prevEditingRef.current
    prevEditingRef.current = isEditing
    if (!turnedOn || !el) return
    const px = card.baseFontSizePx ?? guessMaxFontSizePxFromHtml(card.text ?? '')
    setFontSizeLabelPx(px > 0 ? px : 16)
    const raw = card.text
    if (isProbablyHtml(raw)) {
      el.innerHTML = sanitizeHtmlFragment(raw)
    } else {
      el.textContent = raw
    }
    setDraft(el.innerHTML)
    normalizeEditorLineLayout(el)
    requestAnimationFrame(() => {
      normalizeEditorLineLayout(el)
      el.focus()
      const sel = window.getSelection()
      if (!sel) return
      sel.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel.addRange(range)
      savedEditorRangeRef.current = snapshotSelectionInEditor(el)
    })
  }, [isEditing, card.text, card.id])

  /** WebKit re-applies px `line-height` on spans/divs while typing — strip after DOM/style mutations. */
  useEffect(() => {
    const el = editorRef.current
    if (!isEditing || !el) return
    const run = () => stripGhostInlineSizingDeep(el)
    const obs = new MutationObserver(() => {
      run()
    })
    obs.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    })
    run()
    return () => obs.disconnect()
  }, [isEditing])

  /** Keep a clone of the editor selection while editing (toolbar ops may clear live selection). */
  useEffect(() => {
    if (!isEditing) {
      savedEditorRangeRef.current = null
      return
    }
    const onSelChange = () => {
      const el = editorRef.current
      if (!el) return
      const snap = snapshotSelectionInEditor(el)
      if (snap) savedEditorRangeRef.current = snap
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [isEditing])

  useEffect(() => {
    if (!isEditing) setFontSizeMenuOpen(false)
  }, [isEditing])

  /** Close font-size popover on outside click (native `<select>` is broken by toolbar `preventDefault`). */
  useEffect(() => {
    if (!fontSizeMenuOpen) return
    const onDocDown = (e: MouseEvent) => {
      const root = fontSizeMenuRef.current
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setFontSizeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown, true)
    return () => document.removeEventListener('mousedown', onDocDown, true)
  }, [fontSizeMenuOpen])

  const persistSoon = useCallback(() => {
    if (projectId) schedulePersistCanvas(projectId, 500)
  }, [projectId])

  const exitEditMode = useCallback(() => {
    if (savingRef.current) return
    savingRef.current = true
    const el = editorRef.current
    if (el) normalizeEditorLineLayout(el)
    const htmlRaw = el?.innerHTML ?? draft
    const next = normalizeEditableHtml(sanitizeHtmlFragment(htmlRaw))
    patchTextCard(card.id, { text: next, baseFontSizePx: fontSizeLabelPx })
    setDraft(next)
    console.log(`[text-card] saved id=${card.id} length=${next.length}`)
    setIsEditing(false)
    persistSoon()
    if (selectedTool === 'text-card') {
      setSelectedTool('cursor')
    }
    window.setTimeout(() => {
      savingRef.current = false
    }, 0)
  }, [draft, card.id, fontSizeLabelPx, patchTextCard, persistSoon, selectedTool, setSelectedTool])

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
        if (fontSizeMenuOpen) {
          setFontSizeMenuOpen(false)
          return
        }
        exitEditModeRef.current()
      }
    }
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }, [isEditing, fontSizeMenuOpen])

  const onCopy = useCallback(() => {
    const raw = card.text.trim() ? card.text : ''
    const t = isProbablyHtml(raw) ? htmlToPlainText(raw) : raw
    void navigator.clipboard.writeText(t).catch(() => {
      /* ignore */
    })
  }, [card.text])

  const onEditorInput = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    stripGhostInlineSizingDeep(el)
    setDraft(el.innerHTML)
  }, [])

  const cardSurfaceCls = isEditing
    ? 'ring-1 ring-dashed ring-neutral-400'
    : selected
      ? 'ring-1 ring-neutral-400'
      : ''

  const preventToolbarBlur = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  const runExec = useCallback((fn: () => void) => {
    fn()
    editorRef.current?.focus()
    onEditorInput()
  }, [onEditorInput])

  const applyFontSizeFromToolbar = useCallback(
    (px: number) => {
      setFontSizeLabelPx(px)
      const el = editorRef.current
      if (el) normalizeEditorLineLayout(el)
      editorRef.current?.focus()
      onEditorInput()
    },
    [onEditorInput],
  )

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
        className="relative flex h-full w-full min-h-0 cursor-move flex-col"
        style={{ transform: 'translateZ(0)', willChange: 'transform' }}
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          {selected && !isEditing ? (
            <div
              className="no-rnd-drag pointer-events-auto absolute right-1 top-1 z-[35] origin-top-right"
              style={{ transform: `scale(${invCanvas})` }}
            >
              <div className="no-rnd-drag pointer-events-auto relative z-[35] flex gap-0.5 rounded border border-neutral-300 bg-white p-0.5 font-mono shadow-sm">
                <button
                  type="button"
                  title="复制"
                  className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCopy()
                  }}
                >
                  <Clipboard size={16} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  title="删除"
                  className="rounded p-1.5 text-neutral-900 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteTextCardFromCanvas(card.id)
                  }}
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          {isEditing ? (
            <div
              className="no-rnd-drag pointer-events-auto absolute bottom-full left-1/2 z-[45] mb-2 flex justify-center"
              style={{
                transform: `translateX(-50%) scale(${invCanvas})`,
                transformOrigin: 'bottom center',
              }}
              onMouseDown={preventToolbarBlur}
              onMouseDownCapture={preventToolbarBlur}
            >
              <div className="flex items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 py-1 font-mono shadow-sm">
                <div ref={fontSizeMenuRef} className="relative">
                  <button
                    type="button"
                    aria-label="字号"
                    aria-expanded={fontSizeMenuOpen}
                    aria-haspopup="listbox"
                    className="flex max-w-[5rem] items-center gap-0.5 rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-xs text-neutral-900 hover:bg-neutral-50"
                    onMouseDown={(e) => {
                      preventToolbarBlur(e)
                      const el = editorRef.current
                      if (el) {
                        const snap = snapshotSelectionInEditor(el)
                        if (snap) savedEditorRangeRef.current = snap
                      }
                    }}
                    onClick={() => setFontSizeMenuOpen((o) => !o)}
                  >
                    <span className="tabular-nums">{fontSizeLabelPx}px</span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  </button>
                  {fontSizeMenuOpen ? (
                    <div
                      role="listbox"
                      className="absolute left-0 top-full z-[60] mt-0.5 min-w-[4.75rem] rounded border border-neutral-200 bg-white py-0.5 shadow-md"
                      onMouseDown={preventToolbarBlur}
                    >
                      {FONT_PRESETS.map((px) => (
                        <button
                          key={px}
                          type="button"
                          role="option"
                          aria-selected={px === fontSizeLabelPx}
                          className="block w-full px-2 py-1 text-left text-xs text-neutral-900 hover:bg-neutral-100"
                          onMouseDown={preventToolbarBlur}
                          onClick={() => {
                            applyFontSizeFromToolbar(px)
                            setFontSizeLabelPx(px)
                            setFontSizeMenuOpen(false)
                          }}
                        >
                          {px}px
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  title="粗体"
                  className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
                  onMouseDown={preventToolbarBlur}
                  onClick={() =>
                    runExec(() => {
                      try {
                        document.execCommand('styleWithCSS', false, 'true')
                      } catch {
                        /* ignore */
                      }
                      document.execCommand('bold', false)
                    })
                  }
                >
                  <Bold size={16} strokeWidth={2} aria-hidden />
                </button>

                <div className="mx-0.5 flex items-center gap-0.5 border-l border-neutral-200 pl-1.5">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      className="h-5 w-5 shrink-0 rounded-full border border-neutral-300 ring-offset-1 hover:ring-2 hover:ring-neutral-400"
                      style={{ backgroundColor: c.value }}
                      onMouseDown={preventToolbarBlur}
                      onClick={() =>
                        runExec(() => {
                          try {
                            document.execCommand('styleWithCSS', false, 'true')
                          } catch {
                            /* ignore */
                          }
                          document.execCommand('foreColor', false, c.value)
                        })
                      }
                    />
                  ))}
                </div>

                <div className="mx-0.5 flex items-center gap-0.5 border-l border-neutral-200 pl-1.5">
                  <button
                    type="button"
                    title="左对齐"
                    className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
                    onMouseDown={preventToolbarBlur}
                    onClick={() => runExec(() => execAlign('left'))}
                  >
                    <AlignLeft size={16} strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    title="居中"
                    className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
                    onMouseDown={preventToolbarBlur}
                    onClick={() => runExec(() => execAlign('center'))}
                  >
                    <AlignCenter size={16} strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    title="右对齐"
                    className="rounded p-1.5 text-neutral-900 hover:bg-neutral-100"
                    onMouseDown={preventToolbarBlur}
                    onClick={() => runExec(() => execAlign('right'))}
                  >
                    <AlignRight size={16} strokeWidth={2} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div
            className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[#f5f5f5] font-mono shadow-[0_1px_3px_rgba(0,0,0,0.06)] ${cardSurfaceCls}`}
          >
            {isEditing ? (
              <div className="no-rnd-drag flex min-h-0 flex-1 flex-col px-8 py-6">
                <div
                  ref={editorRef}
                  contentEditable
                  data-text-card-editor="true"
                  suppressContentEditableWarning
                  style={{ fontSize: `${fontSizeLabelPx}px` }}
                  className="text-card-content min-h-0 w-full flex-1 overflow-auto border-0 bg-transparent p-0 font-mono text-[#1a1a1a] outline-none [&_div]:my-0 [&_div]:min-h-0 [&_p]:my-0 [&_p]:min-h-0 empty:before:text-neutral-400 empty:before:content-[attr(data-placeholder)]"
                  data-placeholder={PLACEHOLDER}
                  onInput={onEditorInput}
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
                  /* React 的 onWheel 挂在根上是 passive 的，preventDefault 无效还每滚一下刷一条
                     console 警告；改原生非 passive 监听：卡内滚文字，同时 stopPropagation 不让画布平移 */
                  ref={(el) => {
                    if (!el) return
                    const onWheel = (e: WheelEvent) => {
                      const scroller = textScrollRef.current
                      if (!scroller) return
                      scroller.scrollTop += e.deltaY
                      e.preventDefault()
                      e.stopPropagation()
                    }
                    el.addEventListener('wheel', onWheel, { passive: false })
                    return () => el.removeEventListener('wheel', onWheel)
                  }}
                />
                <div
                  ref={textScrollRef}
                  style={{ fontSize: `${resolvedDisplayPx}px` }}
                  className="text-card-content absolute inset-0 z-0 overflow-auto px-8 py-6 font-mono text-[#1a1a1a] pointer-events-none select-none whitespace-pre-wrap break-words [&_div]:my-0 [&_div]:min-h-0 [&_p]:my-0 [&_p]:min-h-0"
                >
                  {card.text.trim() ? (
                    isProbablyHtml(card.text) ? (
                      <div
                        className="[&_a]:text-blue-600"
                        dangerouslySetInnerHTML={{
                          __html: sanitizeHtmlFragment(card.text),
                        }}
                      />
                    ) : (
                      card.text
                    )
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

export default memo(TextCardItem)
