import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react'
import { CircleDot, Maximize2, Minus, Plus } from 'lucide-react'
import { uploadFilesToCanvas } from '../../lib/canvasUpload.ts'
import {
  computeCanvasZoomAtPoint,
  useProjectStore,
  zoomNudgeStep,
} from '../../store/useStore.ts'
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

function hudPercentLabel(scale: number): string {
  return `${Math.min(300, Math.max(1, Math.round(scale * 100)))}%`
}

const Canvas = forwardRef<HTMLDivElement>(function Canvas(_props, ref) {
  const canvas = useProjectStore((s) => s.currentProjectCanvas)
  const images = canvas?.images ?? EMPTY_IMAGES
  const videos = canvas?.videos ?? EMPTY_VIDEOS
  const textCards = canvas?.textCards ?? EMPTY_TEXT_CARDS
  const clearSelection = useProjectStore((s) => s.clearSelection)
  const selectedImageId = useProjectStore((s) => s.selectedImageId)
  const selectedVideoId = useProjectStore((s) => s.selectedVideoId)
  const selectedTextCardId = useProjectStore((s) => s.selectedTextCardId)
  const canvasPanX = useProjectStore((s) => s.canvasPanX)
  const canvasPanY = useProjectStore((s) => s.canvasPanY)
  const canvasScale = useProjectStore((s) => s.canvasScale)
  const setCanvasPan = useProjectStore((s) => s.setCanvasPan)
  const fitCanvasToImages = useProjectStore((s) => s.fitCanvasToImages)
  const isCanvasSelectionMode = useProjectStore((s) => s.isCanvasSelectionMode)
  const showCanvasDots = useProjectStore((s) => s.showCanvasDots)
  const toggleShowCanvasDots = useProjectStore((s) => s.toggleShowCanvasDots)

  const [dropHighlight, setDropHighlight] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  /** 视口尺寸（视口剔除用）；0 = 尚未测量，此时不剔除。 */
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 })
  const panStartRef = useRef<{
    clientX: number
    clientY: number
    panX: number
    panY: number
  } | null>(null)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const planeRef = useRef<HTMLDivElement | null>(null)
  const hudPercentRef = useRef<HTMLSpanElement | null>(null)

  /** Live viewport for wheel zoom (DOM); store catches up after debounce */
  const liveViewportRef = useRef({
    panX: canvasPanX,
    panY: canvasPanY,
    scale: canvasScale,
  })
  const wheelGestureActiveRef = useRef(false)
  const debounceTimerRef = useRef<number | null>(null)
  const rafIdRef = useRef<number | null>(null)

  const applyPlaneTransformDom = useCallback(() => {
    const plane = planeRef.current
    const hud = hudPercentRef.current
    const viewport = viewportRef.current
    const { panX, panY, scale } = liveViewportRef.current
    if (plane) {
      plane.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`
    }
    if (viewport) {
      // 波点背景跟随平移（live 阶段 store 未更新，直接写 DOM；commit 后 React 渲染会归位到同值）
      viewport.style.backgroundPosition = `${modPos(panX, VIEWPORT_DOT_SPACING_PX)}px ${modPos(panY, VIEWPORT_DOT_SPACING_PX)}px`
    }
    if (hud) {
      hud.textContent = hudPercentLabel(scale)
    }
  }, [])

  const flushPendingWheelZoomCommit = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (wheelGestureActiveRef.current) {
      const { panX, panY, scale } = liveViewportRef.current
      useProjectStore.setState({ canvasPanX: panX, canvasPanY: panY, canvasScale: scale })
      wheelGestureActiveRef.current = false
    }
  }, [])

  const scheduleDebouncedViewportCommit = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      const { panX, panY, scale } = liveViewportRef.current
      useProjectStore.setState({ canvasPanX: panX, canvasPanY: panY, canvasScale: scale })
      wheelGestureActiveRef.current = false
    }, 200)
  }, [])

  /** live 视口偏离 store 提交值超过半屏（或明显缩小）时立即 commit——让视口剔除跟上长距离平移/缩小，不等松手/防抖。 */
  const maybeCommitForCulling = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const st = useProjectStore.getState()
    const { panX, panY, scale } = liveViewportRef.current
    if (
      Math.abs(panX - st.canvasPanX) > el.clientWidth / 2 ||
      Math.abs(panY - st.canvasPanY) > el.clientHeight / 2 ||
      scale < st.canvasScale * 0.8
    ) {
      useProjectStore.setState({ canvasPanX: panX, canvasPanY: panY, canvasScale: scale })
    }
  }, [])

  const scheduleRafApply = useCallback(() => {
    if (rafIdRef.current != null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      applyPlaneTransformDom()
      maybeCommitForCulling()
    })
  }, [applyPlaneTransformDom, maybeCommitForCulling])

  /** Pan / fit / reset: sync live viewport + DOM from store (skip during active wheel gesture) */
  useLayoutEffect(() => {
    if (wheelGestureActiveRef.current) return
    liveViewportRef.current = {
      panX: canvasPanX,
      panY: canvasPanY,
      scale: canvasScale,
    }
    applyPlaneTransformDom()
  }, [canvasPanX, canvasPanY, canvasScale, applyPlaneTransformDom])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    // 平移与滚轮缩放同一套 live viewport 机制：mousemove 只写 DOM，松手一次性 commit store
    const onMove = (e: globalThis.MouseEvent) => {
      const p = panStartRef.current
      if (!p) return
      liveViewportRef.current = {
        ...liveViewportRef.current,
        panX: p.panX + (e.clientX - p.clientX),
        panY: p.panY + (e.clientY - p.clientY),
      }
      scheduleRafApply()
    }
    const onUp = () => {
      panStartRef.current = null
      setIsPanning(false)
      const { panX, panY } = liveViewportRef.current
      setCanvasPan(panX, panY)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isPanning, setCanvasPan, scheduleRafApply])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 正在编辑的文本卡 textarea 等要原生滚动，别抢
      if (
        e.target instanceof Element &&
        (e.target.closest('textarea') || e.target.closest('[data-no-canvas-pan]'))
      ) {
        return
      }
      e.preventDefault()
      wheelGestureActiveRef.current = true
      const cur = liveViewportRef.current
      // deltaMode=1（按行）换算成像素（Firefox 外接鼠标）
      const unit = e.deltaMode === 1 ? 16 : 1
      if (e.ctrlKey || e.metaKey) {
        // Mac 触控板捏合会带 ctrlKey=true 的 wheel 事件；Ctrl/Cmd+滚轮 同样走缩放。
        // 乘法缩放跟随 delta 大小（捏合 delta 小而密 → 平滑），单事件限幅防外接鼠标一格跳太远。
        const r = el.getBoundingClientRect()
        const vx = e.clientX - r.left
        const vy = e.clientY - r.top
        const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * unit * 0.01)))
        const next = computeCanvasZoomAtPoint(cur.panX, cur.panY, cur.scale, cur.scale * factor, vx, vy)
        liveViewportRef.current = {
          panX: next.canvasPanX,
          panY: next.canvasPanY,
          scale: next.canvasScale,
        }
      } else {
        // 双指滚动 / 普通滚轮 → 平移画布（Figma/Miro 习惯），不再和触控板滚动手势打架
        liveViewportRef.current = {
          ...cur,
          panX: cur.panX - e.deltaX * unit,
          panY: cur.panY - e.deltaY * unit,
        }
      }
      scheduleRafApply()
      scheduleDebouncedViewportCommit()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scheduleRafApply, scheduleDebouncedViewportCommit])

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
    if (isInteractiveCanvasChild(e.target)) return

    flushPendingWheelZoomCommit()

    const { panX, panY } = liveViewportRef.current
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX,
      panY,
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

  function applyZoomStep(dir: 1 | -1) {
    flushPendingWheelZoomCommit()
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vx = r.width / 2
    const vy = r.height / 2
    const cur = liveViewportRef.current
    const step = zoomNudgeStep(cur.scale)
    const next = computeCanvasZoomAtPoint(cur.panX, cur.panY, cur.scale, cur.scale + dir * step, vx, vy)
    liveViewportRef.current = {
      panX: next.canvasPanX,
      panY: next.canvasPanY,
      scale: next.canvasScale,
    }
    wheelGestureActiveRef.current = true
    scheduleRafApply()
    scheduleDebouncedViewportCommit()
  }

  function zoomIn() {
    applyZoomStep(1)
  }

  function zoomOut() {
    applyZoomStep(-1)
  }

  function fitAll() {
    flushPendingWheelZoomCommit()
    const el = viewportRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    fitCanvasToImages(r.width, r.height)
  }

  const dotBgX = modPos(canvasPanX, VIEWPORT_DOT_SPACING_PX)
  const dotBgY = modPos(canvasPanY, VIEWPORT_DOT_SPACING_PX)

  /* 视口剔除：世界坐标 AABB 与「可见区 + 四周各一屏 margin」求交，视野外的 item 不挂载。
     screen = world * scale + pan → world = (screen - pan) / scale；选中项始终保留（工具栏锚定其上）。 */
  const cullOff = viewSize.w === 0
  const cullMinX = (-canvasPanX - viewSize.w) / canvasScale
  const cullMaxX = (-canvasPanX + 2 * viewSize.w) / canvasScale
  const cullMinY = (-canvasPanY - viewSize.h) / canvasScale
  const cullMaxY = (-canvasPanY + 2 * viewSize.h) / canvasScale
  const inView = (x: number, y: number, w: number, h: number) =>
    x + w >= cullMinX && x <= cullMaxX && y + h >= cullMinY && y <= cullMaxY
  const visibleImages = cullOff
    ? images
    : images.filter(
        (im) =>
          im.id === selectedImageId ||
          inView(im.position.x, im.position.y, im.size.w, im.size.h),
      )
  const visibleVideos = cullOff
    ? videos
    : videos.filter((v) => v.id === selectedVideoId || inView(v.x, v.y, v.width, v.height))
  const visibleTextCards = cullOff
    ? textCards
    : textCards.filter(
        (tc) => tc.id === selectedTextCardId || inView(tc.x, tc.y, tc.width, tc.height),
      )

  return (
    <div
      ref={setRefs}
      data-canvas-viewport
      onMouseDown={onViewportMouseDown}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        cursor: isCanvasSelectionMode
          ? isPanning
            ? 'grabbing'
            : 'crosshair'
          : isPanning
            ? 'grabbing'
            : 'grab',
        backgroundColor: '#FAF8F5',
        transform: 'translateZ(0)',
        willChange: 'transform',
        ...(showCanvasDots
          ? {
              backgroundImage:
                'radial-gradient(circle, rgba(0, 0, 0, 0.18) 1.1px, transparent 1.6px)',
              backgroundSize: `${VIEWPORT_DOT_SPACING_PX}px ${VIEWPORT_DOT_SPACING_PX}px`,
              backgroundPosition: `${dotBgX}px ${dotBgY}px`,
            }
          : { backgroundImage: 'none' }),
      }}
      className={`relative min-h-0 flex-1 overflow-hidden ${
        dropHighlight ? 'outline outline-2 -outline-offset-2 outline-dashed outline-neutral-400' : ''
      }`}
    >
      <div
        className="absolute bottom-4 right-4 z-30 flex items-center gap-1 rounded-md border border-neutral-200/80 bg-white/95 px-1 py-1 font-mono text-xs shadow-sm backdrop-blur-sm"
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
        <span
          ref={hudPercentRef}
          className="min-w-[2.75rem] px-1 text-center tabular-nums text-neutral-600"
        />
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
        <div className="mx-0.5 h-5 w-px shrink-0 bg-neutral-200/90" aria-hidden />
        <button
          type="button"
          title={showCanvasDots ? '背景波点：开（点击隐藏）' : '背景波点：关（点击显示）'}
          aria-pressed={showCanvasDots}
          className={`no-rnd-drag rounded p-1.5 ${
            showCanvasDots
              ? 'bg-neutral-200 text-neutral-900 ring-1 ring-neutral-400'
              : 'text-neutral-700 hover:bg-neutral-100'
          }`}
          onClick={(ev) => {
            ev.stopPropagation()
            toggleShowCanvasDots()
          }}
        >
          <CircleDot className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {images.length === 0 && videos.length === 0 && textCards.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 text-center font-mono text-sm text-neutral-500">
          Empty canvas — drag images or click toolbar to start
        </div>
      ) : null}

      <div
        ref={planeRef}
        className="canvas-infinite-plane absolute left-0 top-0 origin-top-left"
        style={{
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {visibleImages.map((img) => (
          <ImageItem key={img.id} image={img} />
        ))}
        {visibleVideos.map((v) => (
          <VideoItem key={v.id} video={v} />
        ))}
        {visibleTextCards.map((tc) => (
          <TextCardItem key={tc.id} card={tc} />
        ))}
      </div>
    </div>
  )
})

export default Canvas
