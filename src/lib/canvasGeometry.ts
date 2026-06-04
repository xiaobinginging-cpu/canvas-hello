/**
 * 上传 / 从素材库放置到画布时的默认显示上限（最长边 px）。
 * 之前 600 太小——4K 上传图显示比生成图还小；1024 更接近生成图量级（仍可手动拖拽缩放）。
 */
export const CANVAS_PLACE_MAX_PX = 1024

/** Cap longest side to `maxPx`, preserve aspect ratio. */
export function capDisplaySize(
  naturalW: number,
  naturalH: number,
  maxPx = 600,
): { w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0) return { w: maxPx, h: maxPx }
  const scale = Math.min(1, maxPx / Math.max(naturalW, naturalH))
  return {
    w: Math.max(1, Math.round(naturalW * scale)),
    h: Math.max(1, Math.round(naturalH * scale)),
  }
}

export function readImageFileDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取图片'))
    }
    img.src = url
  })
}

/** Viewport-local coords (top-left of canvas viewport element). */
export function clientPointToCanvasLocal(
  clientX: number,
  clientY: number,
  canvasEl: HTMLElement,
): { x: number; y: number } {
  const r = canvasEl.getBoundingClientRect()
  return { x: clientX - r.left, y: clientY - r.top }
}

/**
 * World/canvas space: inner plane uses translate(pan) scale(s); world = (viewport - pan) / scale.
 */
export function clientPointToWorldCanvas(
  clientX: number,
  clientY: number,
  viewportEl: HTMLElement,
  panX: number,
  panY: number,
  scale: number,
): { x: number; y: number } {
  const v = clientPointToCanvasLocal(clientX, clientY, viewportEl)
  return {
    x: (v.x - panX) / scale,
    y: (v.y - panY) / scale,
  }
}

/** Top-left position to center an item in the visible viewport (world coordinates). */
export function centerWorldPositionInViewport(
  viewportEl: HTMLElement,
  itemW: number,
  itemH: number,
  panX: number,
  panY: number,
  scale: number,
): { x: number; y: number } {
  const r = viewportEl.getBoundingClientRect()
  const vx = r.width / 2
  const vy = r.height / 2
  const worldCx = (vx - panX) / scale
  const worldCy = (vy - panY) / scale
  return {
    x: worldCx - itemW / 2,
    y: worldCy - itemH / 2,
  }
}

export function centerPositionInRect(
  rect: DOMRectReadOnly,
  itemW: number,
  itemH: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, (rect.width - itemW) / 2),
    y: Math.max(0, (rect.height - itemH) / 2),
  }
}
