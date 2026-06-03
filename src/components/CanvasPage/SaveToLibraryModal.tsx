import { useState } from 'react'
import { saveImageToLibrary } from '../../lib/library.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { Image as CanvasImage } from '../../types/image.ts'
import type { MaterialKind } from '../../types/library.ts'
import InlineSpinner from '../shared/InlineSpinner.tsx'

const KINDS: { value: MaterialKind; label: string; hint: string }[] = [
  { value: 'reference', label: '参考图', hint: '可反复调用的参考图' },
  { value: 'raw', label: '原始素材', hint: '底图 / 草图 / 平面图' },
]

/**
 * 「存入素材库」弹窗：选 kind + 起名 + tag，写入全局 `_library/`。
 * 由 store 的 {@link useProjectStore} `saveToLibraryImageId` 驱动、在 CanvasPage 顶层渲染——
 * 不挂在选中图工具栏下，避免点弹窗触发画布取消选中（React portal 事件会冒泡回视口）。
 */
export default function SaveToLibraryModal() {
  const saveToLibraryImageId = useProjectStore((s) => s.saveToLibraryImageId)
  const closeSaveToLibrary = useProjectStore((s) => s.closeSaveToLibrary)
  const canvas = useProjectStore((s) => s.currentProjectCanvas)
  const previewUrl = useProjectStore((s) =>
    saveToLibraryImageId ? s.imageObjectUrls.get(saveToLibraryImageId) : undefined,
  )

  const image = saveToLibraryImageId
    ? canvas?.images.find((im) => im.id === saveToLibraryImageId)
    : undefined

  if (!saveToLibraryImageId || !image) return null
  return <SaveToLibraryForm key={image.id} image={image} previewUrl={previewUrl} onClose={closeSaveToLibrary} />
}

function SaveToLibraryForm({
  image,
  previewUrl,
  onClose,
}: {
  image: CanvasImage
  previewUrl: string | undefined
  onClose: () => void
}) {
  const [kind, setKind] = useState<MaterialKind>('reference')
  const [name, setName] = useState(image.metadata.originalFilename ?? '')
  const [tagsInput, setTagsInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(): Promise<void> {
    setBusy(true)
    setError(null)
    const tags = tagsInput
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    try {
      await saveImageToLibrary(image, { kind, name, tags })
      setBusy(false)
      setDone(true)
      window.setTimeout(onClose, 700)
    } catch (e) {
      setError(e instanceof Error ? e.message : '存入失败')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-to-library-title"
      onMouseDown={(e) => {
        if (busy) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded border border-neutral-200 bg-white p-6 text-left">
        <h2 id="save-to-library-title" className="mb-4 text-lg font-medium text-neutral-900">
          存入素材库
        </h2>

        <div className="mb-5 flex gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs text-neutral-500">类型</p>
            <div className="flex gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  title={k.hint}
                  disabled={busy || done}
                  onClick={() => setKind(k.value)}
                  className={`rounded border px-3 py-1.5 text-xs transition-colors disabled:opacity-60 ${
                    kind === k.value
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="mb-1.5 block text-xs text-neutral-500">名称</label>
        <input
          type="text"
          placeholder="未命名素材"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy || done}
          className="mb-4 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-neutral-900 focus:ring-1 disabled:opacity-60"
          autoFocus
        />

        <label className="mb-1.5 block text-xs text-neutral-500">标签（空格或逗号分隔，可选）</label>
        <input
          type="text"
          placeholder="如：混凝土 黑白灰"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          disabled={busy || done}
          className="mb-5 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-neutral-900 focus:ring-1 disabled:opacity-60"
        />

        {error ? (
          <p className="mb-4 rounded border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          {done ? <span className="mr-auto text-xs text-[#5f7163]">✓ 已存入素材库</span> : null}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {done ? '关闭' : '取消'}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || done}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <InlineSpinner /> : null}
            存入
          </button>
        </div>
      </div>
    </div>
  )
}
