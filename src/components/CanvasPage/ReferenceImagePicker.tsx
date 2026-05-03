import { useRef, useState, type RefObject } from 'react'
import { uploadFilesToCanvas } from '../../lib/canvasUpload.ts'
import { useProjectStore } from '../../store/useStore.ts'

export default function ReferenceImagePicker({
  canvasViewportRef,
  onAddReferenceIds,
  selectionTarget = 'image-gen',
  allowLocalUpload = true,
}: {
  canvasViewportRef: RefObject<HTMLDivElement | null>
  onAddReferenceIds: (ids: string[]) => void
  /** 画布多选参考图合并到 image-gen 或 video-gen 表单。 */
  selectionTarget?: 'image-gen' | 'video-gen'
  /** 视频参考须已落盘 GitHub；关闭本地上传入口（仅画布选择）。 */
  allowLocalUpload?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const enterCanvasSelectionMode = useProjectStore((s) => s.enterCanvasSelectionMode)

  return (
    <div ref={wrapRef} className="relative inline-block">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (!files?.length) return
          void (async () => {
            const ids = await uploadFilesToCanvas(Array.from(files), {
              placement: 'center',
              canvasEl: canvasViewportRef.current,
              imageSource: 'reference',
            })
            if (ids.length) onAddReferenceIds(ids)
          })()
          e.target.value = ''
          setMenuOpen(false)
        }}
      />

      <button
        type="button"
        className="no-rnd-drag rounded border border-dashed border-neutral-400 bg-white px-2 py-1.5 text-xs text-neutral-800 hover:bg-neutral-50"
        onClick={() => setMenuOpen((o) => !o)}
      >
        ＋ 加参考图
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-[130] mt-1 min-w-[12rem] rounded border border-neutral-200 bg-white py-1 text-left shadow-md"
        >
          {allowLocalUpload ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-xs text-neutral-900 hover:bg-neutral-100"
              onClick={() => {
                setMenuOpen(false)
                fileRef.current?.click()
              }}
            >
              📎 从本地上传
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-xs text-neutral-900 hover:bg-neutral-100"
            onClick={() => {
              setMenuOpen(false)
              enterCanvasSelectionMode(selectionTarget)
            }}
          >
            ⊞ 从画布选择
          </button>
        </div>
      ) : null}
    </div>
  )
}
