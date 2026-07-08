import { useCallback, useEffect, useRef, useState } from 'react'
import { Images, LayoutGrid, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import * as github from '../../lib/github.ts'
import {
  addLibraryMaterialToProject,
  deleteLibraryMaterial,
  uploadFilesToLibrary,
} from '../../lib/library.ts'
import { useProjectStore } from '../../store/useStore.ts'
import { formatRelativeTimeZh } from '../../lib/formatRelativeTime.ts'
import type { LibraryMaterial, MaterialKind } from '../../types/library.ts'
import type { ProjectMeta } from '../../types/project.ts'
import InlineSpinner from '../shared/InlineSpinner.tsx'
import Logo from '../Logo.tsx'
import LogoViewportLoading from '../logo/LogoViewportLoading.tsx'
import LibraryThumb from './LibraryThumb.tsx'
import ProjectPickerModal from './ProjectPickerModal.tsx'

const KIND_LABEL: Record<MaterialKind, string> = {
  reference: '参考图',
  raw: '原始素材',
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export default function AssetLibraryPage() {
  const isAuthenticated = useProjectStore((s) => s.isAuthenticated)
  const syncAuthFromGithub = useProjectStore((s) => s.syncAuthFromGithub)

  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>(() =>
    github.storageReady() ? 'loading' : 'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const [materials, setMaterials] = useState<LibraryMaterial[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addingToCanvas, setAddingToCanvas] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const data = await github.loadLibrary()
      setMaterials(data.materials)
      setPhase('idle')
    } catch (e) {
      setError(errMessage(e, '加载失败'))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    syncAuthFromGithub()
    if (!github.storageReady()) return
    queueMicrotask(() => {
      void load()
    })
  }, [syncAuthFromGithub, load])

  function flashToast(msg: string): void {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2600)
  }

  async function handleUpload(files: File[]): Promise<void> {
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const added = await uploadFilesToLibrary(files, 'reference')
      setMaterials((prev) => [...added, ...prev])
      if (added.length) flashToast(`已上传 ${added.length} 张到素材库`)
    } catch (e) {
      setError(errMessage(e, '上传失败'))
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(m: LibraryMaterial): Promise<void> {
    if (!window.confirm(`删除素材「${m.name ?? m.id}」？此操作不可撤销。`)) return
    setDeletingId(m.id)
    try {
      await deleteLibraryMaterial(m.id)
      setMaterials((prev) => prev.filter((x) => x.id !== m.id))
      setSelectedIds((prev) => prev.filter((x) => x !== m.id))
    } catch (e) {
      setError(errMessage(e, '删除失败'))
    } finally {
      setDeletingId(null)
    }
  }

  function toggleSelect(id: string): void {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handlePickProject(project: ProjectMeta): Promise<void> {
    const chosen = materials.filter((m) => selectedIds.includes(m.id))
    if (chosen.length === 0) return
    setAddingToCanvas(true)
    setError(null)
    let ok = 0
    try {
      for (const m of chosen) {
        await addLibraryMaterialToProject(m, project.id)
        ok += 1
      }
    } catch (e) {
      setError(errMessage(e, '加入画布失败'))
    } finally {
      setAddingToCanvas(false)
      setPickerOpen(false)
      setSelectedIds([])
      if (ok > 0) flashToast(`已加入「${project.name.trim() || project.id.slice(0, 8)}」${ok} 张`)
    }
  }

  if (!isAuthenticated && !github.storageReady()) {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-4 bg-[#FAF8F5] font-mono text-neutral-900">
        <p className="text-sm text-neutral-600">请先登录后再查看素材库</p>
        <Link
          to="/"
          className="rounded border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          → 返回首页
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-[#FAF8F5] font-mono text-neutral-900 selection:bg-neutral-200">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (files?.length) void handleUpload(Array.from(files))
          e.target.value = ''
        }}
      />

      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-[#FAF8F5] px-8 py-5">
        <span className="flex shrink-0 items-center gap-6">
          <Logo variant="solid" size={32} />
          <span className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <Images size={18} strokeWidth={2} aria-hidden />
            素材库
          </span>
        </span>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-900 hover:text-neutral-600"
          title="项目库"
        >
          <LayoutGrid size={18} strokeWidth={2} aria-hidden />
          项目库
        </Link>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-[1400px] flex-1 overflow-y-auto px-8 pb-16 pt-10 text-left">
        {error ? (
          <div className="mb-6 rounded border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-900">
            <p className="mb-3">{error}</p>
            <button
              type="button"
              onClick={() => (phase === 'error' ? void load() : setError(null))}
              className="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-800"
            >
              {phase === 'error' ? '重试' : '关闭'}
            </button>
          </div>
        ) : null}

        {phase === 'idle' ? (
          <>
            <div className="mb-8 flex items-center gap-4">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? <InlineSpinner /> : <Upload size={16} strokeWidth={2} aria-hidden />}
                上传图片
              </button>
              <span className="text-xs text-neutral-400">
                {materials.length > 0 ? `${materials.length} 个素材` : ''}
              </span>
            </div>

            {materials.length === 0 ? (
              <p className="text-sm text-neutral-500">
                暂无素材。点上方「上传图片」，或在画布上选中图点工具栏「存入素材库」。
              </p>
            ) : (
              <div className="columns-2 gap-5 sm:columns-3 lg:columns-4 xl:columns-5">
                {materials.map((m) => (
                  <MaterialCard
                    key={m.id}
                    material={m}
                    selected={selectedIds.includes(m.id)}
                    deleting={deletingId === m.id}
                    onToggleSelect={() => toggleSelect(m.id)}
                    onDelete={() => void handleDelete(m)}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </main>

      {selectedIds.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[150] flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-neutral-300 bg-white px-4 py-2 font-mono text-sm shadow-lg">
            <span className="text-neutral-600">已选 {selectedIds.length}</span>
            <button
              type="button"
              disabled={addingToCanvas}
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-1.5 text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              {addingToCanvas ? <InlineSpinner /> : null}
              加入画布
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="rounded-full px-2 py-1.5 text-neutral-500 hover:text-neutral-900"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[160] max-w-sm -translate-x-1/2 rounded border border-neutral-300 bg-neutral-900 px-4 py-2 font-mono text-xs text-white shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      {pickerOpen ? (
        <ProjectPickerModal
          count={selectedIds.length}
          busy={addingToCanvas}
          onPick={(p) => void handlePickProject(p)}
          onClose={() => (addingToCanvas ? undefined : setPickerOpen(false))}
        />
      ) : null}

      {phase === 'loading' ? <LogoViewportLoading /> : null}
    </div>
  )
}

function MaterialCard({
  material,
  selected,
  deleting,
  onToggleSelect,
  onDelete,
}: {
  material: LibraryMaterial
  selected: boolean
  deleting: boolean
  onToggleSelect: () => void
  onDelete: () => void
}) {
  const aspect = material.thumb && material.thumb.h > 0 ? material.thumb.w / material.thumb.h : 1

  return (
    <div
      className={`group relative mb-5 flex break-inside-avoid flex-col overflow-hidden rounded border bg-white transition-colors ${
        selected ? 'border-neutral-900 ring-1 ring-neutral-900' : 'border-neutral-200'
      }`}
    >
      <button
        type="button"
        onClick={onToggleSelect}
        className="relative w-full"
        style={{ aspectRatio: aspect }}
        aria-pressed={selected}
      >
        <LibraryThumb material={material} className="h-full w-full" />
        <span className="absolute left-1.5 top-1.5 rounded bg-white/85 px-1.5 py-0.5 text-[10px] text-neutral-700">
          {KIND_LABEL[material.kind]}
        </span>
        {selected ? (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[11px] text-white">
            ✓
          </span>
        ) : null}
        {material.tags && material.tags.length ? (
          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex flex-wrap gap-1">
            {material.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-white/85 px-1.5 py-0.5 text-[10px] text-neutral-700 backdrop-blur-sm"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </button>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <div className="min-w-0">
          <p className="line-clamp-1 break-all text-xs text-neutral-900">
            {material.name?.trim() || material.id}
          </p>
          <p className="text-[10px] text-neutral-400">{formatRelativeTimeZh(material.addedAt)}</p>
        </div>
        <button
          type="button"
          title="删除"
          disabled={deleting}
          onClick={onDelete}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 disabled:opacity-50"
        >
          {deleting ? '…' : '删除'}
        </button>
      </div>
    </div>
  )
}
