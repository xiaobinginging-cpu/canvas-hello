import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { uploadFilesToCanvas } from '../../lib/canvasUpload.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { Image as CanvasImage } from '../../types/image.ts'
import type { TextCard, VideoItem as CanvasVideo } from '../../types/project.ts'
import ImageItem from './ImageItem.tsx'
import TextCardItem from './TextCardItem.tsx'
import VideoItem from './VideoItem.tsx'

/** Stable fallback — never use inline `[]` in zustand selectors (new ref each snapshot → infinite loop). */
const EMPTY_IMAGES: readonly CanvasImage[] = []

const EMPTY_TEXT_CARDS: readonly TextCard[] = []

const EMPTY_VIDEOS: readonly CanvasVideo[] = []

/** Viewport dot grid: fixed 30px on screen, not scaled with canvas zoom. */
const VIEWPORT_DOT_SPACING_PX = 30

/** Positive modulo (JS `%` is negative for negative lhs). */
function modPos(n: number, m: number): number {
  if (m === 0) return 0
  return ((n % m) + m) % m
}

const Canvas = forwardRef<HTMLDivElement>(function Canvas(_props, ref) {
  const canvas = useProjectStore((s) => s.currentProjectCanvas)
  const images = canvas?.images ?? EMPTY_IMAGES
  const videos = canvas?.videos ?? EMPTY_VIDEOS
  const textCards = canvas?.textCards ?? EMPTY_TEXT_CARDS
  const selectedTool = useProjectStore((s) => s.selectedTool)
  const isPromptGenPickMode = selectedTool === 'prompt-gen'
  const clearSelection = useProjectStore((s) => s.clearSelection)
  const canvasPanX = useProjectStore((s) => s.canvasPanX)
  const canvasPanY = useProjectStore((s) => s.canvasPanY)
  const canvasScale = useProjectStore((s) => s.canvasScale)
  const setCanvasPan = useProjectStore((s) => s.setCanvasPan)
  const nudgeCanvasZoom = useProjectStore((s) => s.nudgeCanvasZoom)
  const fitCanvasToImages = useProjectStore((s) => s.fitCanvasToImages)
  const isCanvasSelectionMode = useProjectStore((s) => s.isCanvasSelectionMode)

  const [dropHighlight, setDropHighlight] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{
    clientX: number
    clientY: number
    panX: number
    panY: number
  } | null>(null)

  const viewportRef = useRef<HTMLDivElement | null>(null)

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  useEffect(() => {
    if (!isPanning) return
    const onMove = (e: globalThis.MouseEvent) => {
      const p = panStartRef.current
      if (!p) return
      setCanvasPan(p.panX + (e.clientX - p.clientX), p.panY + (e.clientY - p.clientY))
    }
    const onUp = () => {
      panStartRef.current = null
      setIsPanning(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isPanning, setCanvasPan])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const vx = e.clientX - r.left
      const vy = e.clientY - r.top
      const dir = e.deltaY > 0 ? -1 : 1
      useProjectStore.getState().nudgeCanvasZoom(dir, vx, vy)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function isInteractiveCanvasChild(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    return Boolean(
      target.closest('[data-image-item]') ||
        target.closest('[data-video-item]') ||
        target.closest('[data-text-card-item]') ||
        target.closest('[data-canvas-hud]') ||
        target.closest('[data-no-canvas-pan]'),
    )
  }

  function onViewportMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    if (isCanvasSelectionMode) return
    if (isPromptGenPickMode) {
      if (!isInteractiveCanvasChild(e.target)) clearSelection()
      return
    }
    if (isInteractiveCanvasChild(e.target)) return

    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: canvasPanX,
      panY: canvasPanY,
    }
    setIsPanning(true)
    clearSelection()
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropHighlight) setDropHighlight(true)
  }

  function onDragLeave(e: DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDropHighlight(false)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDropHighlight(false)
    const el = e.currentTarget as HTMLDivElement
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    void uploadFilesToCanvas(files, {
      placement: 'drop',
      canvasEl: el,
      dropClient: { x: e.clientX, y: e.clientY },
    })
  }

  const zoomPercent = Math.min(300, Math.max(1, Math.round(canvasScale * 100)))

  function zoomIn() {
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    nudgeCanvasZoom(1, r.width / 2, r.height / 2)
  }

  function zoomOut() {
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    nudgeCanvasZoom(-1, r.width / 2, r.height / 2)
  }

  function fitAll() {
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    fitCanvasToImages(r.width, r.height)
  }

  const planeTransform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasScale})`

  const dotBgX = modPos(canvasPanX, VIEWPORT_DOT_SPACING_PX)
  const dotBgY = modPos(canvasPanY, VIEWPORT_DOT_SPACING_PX)

  return (
    <div
      ref={setRefs}
      data-canvas-viewport
      onMouseDown={onViewportMouseDown}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        cursor: isCanvasSelectionMode || isPromptGenPickMode
          ? isPanning
            ? 'grabbing'
            : 'crosshair'
          : isPanning
            ? 'grabbing'
            : 'grab',
        backgroundColor: '#FAF8F5',
        backgroundImage:
          'radial-gradient(circle, rgba(0, 0, 0, 0.18) 1.5px, transparent 2px)',
        backgroundSize: `${VIEWPORT_DOT_SPACING_PX}px ${VIEWPORT_DOT_SPACING_PX}px`,
        backgroundPosition: `${dotBgX}px ${dotBgY}px`,
      }}
      className={`relative min-h-0 flex-1 overflow-hidden ${
        dropHighlight ? 'outline outline-2 -outline-offset-2 outline-dashed outline-neutral-400' : ''
      }`}
    >
      <div
        className="absolute bottom-4 left-4 z-30 flex items-center gap-1 rounded-md border border-neutral-200/80 bg-white/95 px-1 py-1 font-mono text-xs shadow-sm backdrop-blur-sm"
        data-canvas-hud
      >
        <button
          type="button"
          aria-label="Zoom out"
          className="no-rnd-drag rounded p-1.5 text-neutral-700 hover:bg-neutral-100"
          onClick={(ev) => {
            ev.stopPropagation()
            zoomOut()
          }}
        >
          <Minus className="h-4 w-4" strokeWidth={2} />
        </button>
        <span className="min-w-[2.75rem] px-1 text-center tabular-nums text-neutral-600">
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          className="no-rnd-drag rounded p-1.5 text-neutral-700 hover:bg-neutral-100"
          onClick={(ev) => {
            ev.stopPropagation()
            zoomIn()
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Fit all images in view"
          title="Fit all images"
          className="no-rnd-drag rounded p-1.5 text-neutral-700 hover:bg-neutral-100"
          onClick={(ev) => {
            ev.stopPropagation()
            fitAll()
          }}
        >
          <Maximize2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {images.length === 0 && videos.length === 0 && textCards.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 text-center font-mono text-sm text-neutral-500">
          Empty canvas — drag images or click toolbar to start
        </div>
      ) : null}

      <div
        className="canvas-infinite-plane absolute left-0 top-0 origin-top-left will-change-transform"
        style={{
          transform: planeTransform,
          transformOrigin: '0 0',
        }}
      >
        {images.map((img) => (
          <ImageItem key={img.id} image={img} />
        ))}
        {videos.map((v) => (
          <VideoItem key={v.id} video={v} />
        ))}
        {textCards.map((tc) => (
          <TextCardItem key={tc.id} card={tc} />
        ))}
      </div>
    </div>
  )
})

export default Canvas
