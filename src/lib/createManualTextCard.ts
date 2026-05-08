import { nanoid } from 'nanoid'
import { persistCanvasNow } from './canvasPersist.ts'
import type { TextCard } from '../types/project.ts'
import { useProjectStore } from '../store/useStore.ts'

const W = 400
const H = 300

/** 在 viewport 中心（世界坐标）插入空白文本卡并排队进入编辑模式。 */
export function createManualTextCardAtViewportCenter(viewportEl: HTMLElement | null): void {
  const state = useProjectStore.getState()
  const { canvasPanX, canvasPanY, canvasScale } = state

  let cx = 200
  let cy = 160
  if (viewportEl) {
    const r = viewportEl.getBoundingClientRect()
    const vx = r.width / 2
    const vy = r.height / 2
    cx = (vx - canvasPanX) / canvasScale
    cy = (vy - canvasPanY) / canvasScale
  }

  const id = nanoid()
  const card: TextCard = {
    id,
    x: cx - W / 2,
    y: cy - H / 2,
    width: W,
    height: H,
    text: '',
    baseFontSizePx: 16,
    source: { kind: 'manual' },
    createdAt: Date.now(),
  }

  state.addTextCard(card)
  state.setPendingTextCardEditId(id)
  console.log(`[text-card] new empty created id=${id}`)
  void persistCanvasNow()
}
