import { useRef, useState, type RefObject } from 'react'
import { BoxSelect, Images, Upload } from 'lucide-react'
import { uploadFilesToCanvas } from '../../lib/canvasUpload.ts'
import { useProjectStore } from '../../store/useStore.ts'
import LibraryPickerModal from './LibraryPickerModal.tsx'

const VIDEO_REF_HELP =
  '图生视频参考须为已同步到 GitHub 的图片（路径 assets/…）；上传或生成中的图片请等待保存完成后再从画布选择；也可先用图像生成落盘后选用。'

export default function ReferenceImagePicker({
  canvasViewportRef,
  onAddReferenceIds,
  selectionTarget = 'image-gen',
  allowLocalUpload = true,
}: {
  canvasViewportRef: RefObject<HTMLDivElement | null>
  onAddReferenceIds: (ids: string[]) => void
  /** 画布多选参考图合并到对应表单。 */
  selectionTarget?: 'image-gen' | 'video-gen' | 'prompt-gen'
  /** 视频参考须已落盘 GitHub；关闭本地上传入口（仅画布选择）。 */
  allowLocalUpload?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const enterCanvasSelectionMode = useProjectStore((s) => s.enterCanvasSelectionMode)

  const pickerTitle =
    selectionTarget === 'video-gen' ? VIDEO_REF_HELP : undefined

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
        title={pickerTitle}
        className="no-rnd-drag rounded border border-dashed border-neutral-400 bg-white px-2 py-1.5 text-xs text-neutral-800 hover:bg-neutral-50"
        onClick={() => setMenuOpen((o) => !o)}
      >
        ＋ 加参考图
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-[130] mt-1 min-w-[14rem] rounded border border-neutral-200 bg-white py-1 text-left shadow-md"
        >
          {allowLocalUpload ? (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-neutral-900 hover:bg-neutral-100"
              onClick={() => {
                setMenuOpen(false)
                fileRef.current?.click()
              }}
            >
              <Upload size={14} strokeWidth={2} aria-hidden />
              从本地上传
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-neutral-900 hover:bg-neutral-100"
            onClick={() => {
              setMenuOpen(false)
              enterCanvasSelectionMode(selectionTarget)
            }}
          >
            <BoxSelect size={14} strokeWidth={2} aria-hidden />
            从画布选择
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-neutral-900 hover:bg-neutral-100"
            onClick={() => {
              setMenuOpen(false)
              setLibraryOpen(true)
            }}
          >
            <Images size={14} strokeWidth={2} aria-hidden />
            从素材库
          </button>
          {selectionTarget === 'video-gen' ? (
            <p className="border-t border-neutral-100 px-3 pb-2 pt-1 text-[10px] leading-snug text-neutral-500">
              视频参考仅支持已写入仓库的图片（路径须为 assets/…）；生成中或尚未同步的图不可用。
            </p>
          ) : null}
        </div>
      ) : null}

      {libraryOpen ? (
        <LibraryPickerModal
          canvasViewportRef={canvasViewportRef}
          onClose={() => setLibraryOpen(false)}
          onAdded={(ids) => {
            if (ids.length) onAddReferenceIds(ids)
            setLibraryOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}
