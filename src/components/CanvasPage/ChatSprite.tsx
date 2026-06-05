import { useRef, useState } from 'react'
import { useChatStore } from '../../store/useChatStore.ts'

const SIZE = 52
const DRAG_THRESHOLD = 4

/**
 * 画布上可拖动的聊天小精灵（黑白灰发光小球 + 两只眼睛）。
 * 拖动 = 移动并记位置（localStorage）；点击（未拖动）= 打开聊天面板。屏幕 fixed 坐标。
 */
export default function ChatSprite() {
  const panelOpen = useChatStore((s) => s.panelOpen)
  const spriteX = useChatStore((s) => s.spriteX)
  const spriteY = useChatStore((s) => s.spriteY)
  const setSpritePos = useChatStore((s) => s.setSpritePos)
  const openPanel = useChatStore((s) => s.openPanel)

  // 默认右下角（工具栏上方）。首帧读窗口尺寸（纯客户端 SPA，无 SSR）。
  const [fallback] = useState(() => ({
    x: window.innerWidth - SIZE - 24,
    y: window.innerHeight - SIZE - 96,
  }))

  const drag = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  if (panelOpen) return null

  // 夹回当前可视区——存的位置可能是别的分辨率/拖到屏外留下的，否则小精灵会"消失"在屏幕外。
  const maxX = Math.max(8, window.innerWidth - SIZE - 8)
  const maxY = Math.max(8, window.innerHeight - SIZE - 8)
  const x = Math.min(maxX, Math.max(8, spriteX ?? fallback?.x ?? 24))
  const y = Math.min(maxY, Math.max(8, spriteY ?? fallback?.y ?? 24))

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    drag.current = { startX: e.clientX, startY: e.clientY, originX: x, originY: y, moved: false }
  }
  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current
    if (!d) return
    const ddx = e.clientX - d.startX
    const ddy = e.clientY - d.startY
    if (Math.abs(ddx) > DRAG_THRESHOLD || Math.abs(ddy) > DRAG_THRESHOLD) d.moved = true
    const nx = Math.max(8, Math.min(window.innerWidth - SIZE - 8, d.originX + ddx))
    const ny = Math.max(8, Math.min(window.innerHeight - SIZE - 8, d.originY + ddy))
    setSpritePos(nx, ny)
  }
  function onPointerUp() {
    const moved = drag.current?.moved
    drag.current = null
    if (!moved) openPanel()
  }

  return (
    <button
      type="button"
      title="聊天"
      aria-label="打开聊天"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="chat-sprite-orb fixed z-[170] touch-none"
      style={{ left: x, top: y, width: SIZE, height: SIZE, cursor: 'grab' }}
    >
      {/* 发光层：模糊 + 形状蠕动 + 颜色流动 */}
      <span className="chat-sprite-glow pointer-events-none absolute inset-0" aria-hidden />
      {/* 眼睛层：清晰、偏上（避免居中像猪鼻子）、偶尔眨 */}
      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ paddingBottom: SIZE * 0.3 }}
      >
        <span className="flex items-center gap-[7px]">
          <span className="chat-sprite-eye block h-[8px] w-[6px] rounded-full bg-neutral-900" />
          <span className="chat-sprite-eye block h-[8px] w-[6px] rounded-full bg-neutral-900" />
        </span>
      </span>
    </button>
  )
}
