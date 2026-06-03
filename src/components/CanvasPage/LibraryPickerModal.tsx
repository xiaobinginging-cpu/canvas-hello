import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import * as github from '../../lib/github.ts'
import { addLibraryMaterialToCanvasAsReference } from '../../lib/library.ts'
import type { LibraryMaterial, MaterialKind } from '../../types/library.ts'
import InlineSpinner from '../shared/InlineSpinner.tsx'
import LibraryThumb from '../LibraryPage/LibraryThumb.tsx'

const KIND_LABEL: Record<MaterialKind, string> = {
  reference: '参考图',
  raw: '原始素材',
}

/**
 * 「+ 加参考图 → 🗂 从素材库」弹窗：浏览全局素材、多选，逐个拷进当前 project 当参考图。
 * @param canvasViewportRef 当前画布视口（confirm 时读 `.current` 做落点居中）。
 * @param onAdded 拷入完成、回传新建画布图 id（写进生成表单 referenceImageIds）。
 */
export default function LibraryPickerModal({
  canvasViewportRef,
  onClose,
  onAdded,
}: {
  canvasViewportRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onAdded: (ids: string[]) => void
}) {
  const [phase, setPhase] = useState<'loading' | 'idle' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [materials, setMaterials] = useState<LibraryMaterial[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await github.loadLibrary()
        if (cancelled) return
        setMaterials(data.materials)
        setPhase('idle')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '加载失败')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function toggle(id: string): void {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleConfirm(): Promise<void> {
    if (selected.length === 0) return
    setAdding(true)
    setError(null)
    const ids: string[] = []
    const canvasEl = canvasViewportRef.current
    try {
      for (const id of selected) {
        const m = materials.find((x) => x.id === id)
        if (!m) continue
        const newId = await addLibraryMaterialToCanvasAsReference(m, canvasEl)
        ids.push(newId)
      }
      onAdded(ids)
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
      // 已成功拷入的也回传，避免丢失
      if (ids.length) onAdded(ids)
      setAdding(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-picker-title"
      onMouseDown={(e) => {
        if (adding) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded border border-neutral-200 bg-white text-left">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
          <h2 id="library-picker-title" className="text-base font-medium text-neutral-900">
            从素材库选择
          </h2>
          <Link
            to="/library"
            className="text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800"
          >
            管理素材库 →
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === 'loading' ? (
            <div className="flex items-center justify-center py-12 text-xs text-neutral-400">
              <InlineSpinner />
              <span className="ml-2">加载中…</span>
            </div>
          ) : phase === 'error' ? (
            <p className="rounded border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
              {error}
            </p>
          ) : materials.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-500">
              素材库为空。先在画布上选中图「存入素材库」。
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
              {materials.map((m) => {
                const isSel = selected.includes(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={adding}
                    onClick={() => toggle(m.id)}
                    className={`group relative flex flex-col overflow-hidden rounded border text-left transition-colors disabled:opacity-60 ${
                      isSel ? 'border-neutral-900 ring-1 ring-neutral-900' : 'border-neutral-200 hover:border-neutral-400'
                    }`}
                  >
                    <div className="relative aspect-square w-full">
                      <LibraryThumb material={m} className="h-full w-full" />
                      <span className="absolute left-1 top-1 rounded bg-white/85 px-1 py-0.5 text-[9px] text-neutral-700">
                        {KIND_LABEL[m.kind]}
                      </span>
                      {isSel ? (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[11px] text-white">
                          ✓
                        </span>
                      ) : null}
                    </div>
                    <p className="line-clamp-1 break-all px-1.5 py-1 text-[10px] text-neutral-700">
                      {m.name?.trim() || m.id}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-5 py-4">
          <span className="text-xs text-neutral-500">
            {selected.length > 0 ? `已选 ${selected.length} 个` : '点击图片选择'}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={adding}
              className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={adding || selected.length === 0}
              className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {adding ? <InlineSpinner /> : null}
              加入参考
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
