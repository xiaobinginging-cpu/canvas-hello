import { customAlphabet } from 'nanoid'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { normalizeCanvasFromServer } from '../../lib/canvasHydration.ts'
import {
  deleteImageFromCanvas,
  deleteTextCardFromCanvas,
  deleteVideoFromCanvas,
  uploadFilesToCanvas,
} from '../../lib/canvasUpload.ts'
import * as github from '../../lib/github.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { CanvasData, ProjectMeta } from '../../types/project'
import LogoViewportLoading from '../logo/LogoViewportLoading.tsx'
import NewProjectModal from '../HomePage/NewProjectModal.tsx'
import Canvas from './Canvas.tsx'
import DetailCard from './DetailCard.tsx'
import ImageGenPanel from './ImageGenPanel.tsx'
import VideoGenPanel from './VideoGenPanel.tsx'
import PromptGenPanel from './PromptGenPanel.tsx'
import Sidebar from './Sidebar.tsx'
import Toolbar from './Toolbar.tsx'
import Topbar from './Topbar.tsx'

const newProjectId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)

function nowMs(): number {
  return Date.now()
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export default function CanvasPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const canvasViewportRef = useRef<HTMLDivElement>(null)

  const setProjects = useProjectStore((s) => s.setProjects)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const clearCurrentProject = useProjectStore((s) => s.clearCurrentProject)
  const addProject = useProjectStore((s) => s.addProject)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const currentProjectMeta = useProjectStore((s) => s.currentProjectMeta)
  const selectedImageId = useProjectStore((s) => s.selectedImageId)
  const selectedVideoId = useProjectStore((s) => s.selectedVideoId)
  const selectedTextCardId = useProjectStore((s) => s.selectedTextCardId)
  const clearSelection = useProjectStore((s) => s.clearSelection)
  const detailCardImageId = useProjectStore((s) => s.detailCardImageId)
  const closeDetailCard = useProjectStore((s) => s.closeDetailCard)

  const [toast, setToast] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'image'; id: string } | { kind: 'video'; id: string } | { kind: 'text'; id: string } | null
  >(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newModalKey, setNewModalKey] = useState(0)
  const [createBusy, setCreateBusy] = useState(false)

  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(t)
  }, [toast])

  /** Keep sidebar list aligned with GitHub when opening canvas directly. */
  useEffect(() => {
    if (!github.isAuthenticated()) return
    void (async () => {
      try {
        await github.ensureRepo()
        const list = await github.listProjects()
        setProjects(list)
      } catch {
        /* ignore */
      }
    })()
  }, [setProjects])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    clearCurrentProject()
    void (async () => {
      try {
        const { meta, canvas } = await github.loadProject(projectId)
        if (cancelled) return
        setCurrentProject({
          id: projectId,
          meta,
          canvas: normalizeCanvasFromServer(canvas),
        })
      } catch (e) {
        if (cancelled) return
        setToast(errMessage(e, '项目加载失败'))
        navigate('/', { replace: true })
      }
    })()
    return () => {
      cancelled = true
      clearCurrentProject()
    }
  }, [projectId, clearCurrentProject, setCurrentProject, navigate])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (pendingDelete) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setPendingDelete(null)
        }
        return
      }
      if (detailCardImageId && e.key === 'Escape') {
        e.preventDefault()
        closeDetailCard()
        return
      }
      if (e.key === 'Escape') clearSelection()
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const editingTextCard =
        document.activeElement instanceof HTMLTextAreaElement &&
        document.activeElement.dataset.textCardEditor === 'true'
      if (editingTextCard) return

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImageId) {
        e.preventDefault()
        setPendingDelete({ kind: 'image', id: selectedImageId })
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVideoId) {
        e.preventDefault()
        setPendingDelete({ kind: 'video', id: selectedVideoId })
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTextCardId) {
        e.preventDefault()
        setPendingDelete({ kind: 'text', id: selectedTextCardId })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    pendingDelete,
    detailCardImageId,
    selectedImageId,
    selectedVideoId,
    selectedTextCardId,
    clearSelection,
    closeDetailCard,
  ])

  const canvasReady = Boolean(
    projectId && currentProjectId === projectId && currentProjectMeta !== null,
  )

  async function handleCreateProject(name: string): Promise<void> {
    setCreateBusy(true)
    const id = newProjectId()
    const now = nowMs()
    const meta: ProjectMeta = {
      id,
      name: name.trim() || '未命名',
      createdAt: now,
      updatedAt: now,
      pinned: false,
    }
    const canvas: CanvasData = { images: [], videos: [] }
    try {
      await github.saveProject(id, meta, canvas, [])
      addProject(meta)
      setNewOpen(false)
      navigate(`/canvas/${id}`)
    } catch (e) {
      console.error(e)
      showToast(errMessage(e, '创建失败'))
    } finally {
      setCreateBusy(false)
    }
  }

  if (!projectId) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex h-svh min-h-0 flex-col bg-[#FAF8F5] font-mono text-neutral-900">
      <div className="flex min-h-0 flex-1 flex-row">
        <Sidebar
          createBusy={createBusy}
          onOpenNewModal={() => {
            setNewModalKey((k) => k + 1)
            setNewOpen(true)
          }}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar />
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Canvas ref={canvasViewportRef} />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-hidden
            onChange={(e) => {
              const files = e.target.files
              if (files?.length) {
                void uploadFilesToCanvas(Array.from(files), {
                  placement: 'center',
                  canvasEl: canvasViewportRef.current,
                })
              }
              e.target.value = ''
            }}
          />
          <Toolbar
            onPickImageFiles={() => fileInputRef.current?.click()}
            canvasViewportRef={canvasViewportRef}
          />
          <ImageGenPanel canvasViewportRef={canvasViewportRef} />
          <VideoGenPanel canvasViewportRef={canvasViewportRef} />
          <PromptGenPanel canvasViewportRef={canvasViewportRef} />
        </div>
      </div>

      <NewProjectModal
        key={newModalKey}
        open={newOpen}
        loading={createBusy}
        onClose={() => setNewOpen(false)}
        onCreate={(name) => void handleCreateProject(name)}
      />

      <DetailCard />

      {toast ? (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-[200] max-w-sm -translate-x-1/2 rounded border border-neutral-300 bg-neutral-900 px-4 py-2 font-mono text-xs text-white shadow-lg"
        >
          {toast}
        </div>
      ) : null}

      {!canvasReady ? <LogoViewportLoading /> : null}

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 px-4 font-mono"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-item-title"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) setPendingDelete(null)
          }}
        >
          <div className="w-full max-w-sm rounded border border-neutral-200 bg-white p-6 text-left shadow-none">
            <h2 id="delete-item-title" className="mb-4 text-sm font-medium text-neutral-900">
              {pendingDelete.kind === 'image'
                ? '删除图片？'
                : pendingDelete.kind === 'video'
                  ? '删除视频？'
                  : '删除文本卡？'}
            </h2>
            <p className="mb-6 text-xs text-neutral-600">
              {pendingDelete.kind === 'image'
                ? '该操作将从画布移除图片（GitHub 上的资源文件暂保留）。'
                : pendingDelete.kind === 'video'
                  ? '该操作将从画布移除视频（GitHub 上的资源文件暂保留）。'
                  : '该操作将从画布移除该文本卡。'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded border border-neutral-300 bg-white px-4 py-2 text-xs text-neutral-800 hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = pendingDelete
                  if (!p) return
                  setPendingDelete(null)
                  if (p.kind === 'image') void deleteImageFromCanvas(p.id)
                  else if (p.kind === 'video') void deleteVideoFromCanvas(p.id)
                  else void deleteTextCardFromCanvas(p.id)
                }}
                className="rounded border border-red-800 bg-red-800 px-4 py-2 text-xs text-white hover:bg-red-900"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
