import { useCallback, useEffect, useMemo, useState } from 'react'
import { Images, LayoutGrid, Pin, Settings } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { customAlphabet } from 'nanoid'
import * as github from '../../lib/github.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { CanvasData, ProjectMeta } from '../../types/project'
import DeleteConfirmModal from './DeleteConfirmModal.tsx'
import NewProjectButton from './NewProjectButton.tsx'
import NewProjectModal from './NewProjectModal.tsx'
import PATSetup from './PATSetup.tsx'
import ProjectCard from './ProjectCard.tsx'
import ProjectGrid from './ProjectGrid.tsx'
import RenameProjectModal from './RenameProjectModal.tsx'
import { useEffectiveUserLabel } from '../../hooks/useEffectiveUserLabel.ts'
import Logo from '../Logo.tsx'
import LogoViewportLoading from '../logo/LogoViewportLoading.tsx'

const newProjectId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)

function nowMs(): number {
  return Date.now()
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export default function HomePage() {
  const navigate = useNavigate()
  const projects = useProjectStore((s) => s.projects)
  const isAuthenticated = useProjectStore((s) => s.isAuthenticated)
  const headerUserLabel = useEffectiveUserLabel()
  const syncAuthFromGithub = useProjectStore((s) => s.syncAuthFromGithub)
  const setProjects = useProjectStore((s) => s.setProjects)
  const addProject = useProjectStore((s) => s.addProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const removeProject = useProjectStore((s) => s.removeProject)
  const clearAuth = useProjectStore((s) => s.clearAuth)

  const [loadPhase, setLoadPhase] = useState<'idle' | 'loading' | 'error'>(() =>
    github.isAuthenticated() ? 'loading' : 'idle',
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newModalKey, setNewModalKey] = useState(0)
  const [renameTarget, setRenameTarget] = useState<ProjectMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null)

  const [createBusy, setCreateBusy] = useState(false)
  const [renameBusy, setRenameBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [pinBusyId, setPinBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null)

  const clearActionError = useCallback(() => {
    setActionError(null)
    setRetryAction(null)
  }, [])

  const loadLibrary = useCallback(async () => {
    setLoadPhase('loading')
    setLoadError(null)
    try {
      await github.ensureRepo()
      const list = await github.listProjects()
      setProjects(list)
      setLoadPhase('idle')
    } catch (e) {
      setLoadError(errMessage(e, '加载失败'))
      setLoadPhase('error')
    }
  }, [setProjects])

  useEffect(() => {
    syncAuthFromGithub()
    if (!github.isAuthenticated()) return
    queueMicrotask(() => {
      void loadLibrary()
    })
  }, [syncAuthFromGithub, loadLibrary])

  const pinnedProjects = useMemo(
    () =>
      [...projects]
        .filter((p) => p.pinned)
        .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [projects],
  )

  const recentProjects = useMemo(
    () =>
      [...projects]
        .filter((p) => !p.pinned)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  )

  function handleLogout(): void {
    github.clearToken()
    clearAuth()
  }

  async function handleCreateProject(name: string): Promise<void> {
    clearActionError()
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
    const canvas: CanvasData = { images: [] }

    const attemptSave = async (): Promise<void> => {
      await github.saveProject(id, meta, canvas, [])
      addProject(meta)
      setNewOpen(false)
      navigate(`/canvas/${id}`)
    }

    const scheduleCreateRetry = (run: () => Promise<void>): void => {
      setRetryAction(() => async () => {
        clearActionError()
        setCreateBusy(true)
        try {
          await run()
        } catch (e2) {
          console.error(e2)
          setActionError(errMessage(e2, '保存失败'))
          scheduleCreateRetry(run)
        } finally {
          setCreateBusy(false)
        }
      })
    }

    try {
      await attemptSave()
    } catch (e) {
      console.error(e)
      setActionError(errMessage(e, '保存失败'))
      scheduleCreateRetry(attemptSave)
    } finally {
      setCreateBusy(false)
    }
  }

  async function handleTogglePin(meta: ProjectMeta): Promise<void> {
    clearActionError()
    setPinBusyId(meta.id)
    try {
      const { canvas } = await github.loadProject(meta.id)
      const now = nowMs()
      const pinned = !meta.pinned
      const next: ProjectMeta = {
        ...meta,
        pinned,
        pinnedAt: pinned ? now : undefined,
        updatedAt: now,
      }
      await github.saveProject(meta.id, next, canvas, [])
      updateProject(meta.id, next)
    } catch (e) {
      console.error(e)
      setActionError(errMessage(e, '置顶失败'))
      setRetryAction(() => async () => {
        clearActionError()
        await handleTogglePin(meta)
      })
    } finally {
      setPinBusyId(null)
    }
  }

  async function handleRenameConfirm(name: string): Promise<void> {
    const target = renameTarget
    if (!target) return
    clearActionError()
    setRenameBusy(true)
    try {
      const { canvas } = await github.loadProject(target.id)
      const now = nowMs()
      const next: ProjectMeta = {
        ...target,
        name,
        updatedAt: now,
      }
      await github.saveProject(target.id, next, canvas, [])
      updateProject(target.id, next)
      setRenameTarget(null)
    } catch (e) {
      console.error(e)
      setActionError(errMessage(e, '重命名失败'))
      setRetryAction(() => async () => {
        clearActionError()
        await handleRenameConfirm(name)
      })
    } finally {
      setRenameBusy(false)
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    const target = deleteTarget
    if (!target) return
    clearActionError()
    setDeleteBusy(true)
    try {
      await github.deleteProject(target.id)
      removeProject(target.id)
      setDeleteTarget(null)
    } catch (e) {
      console.error(e)
      setActionError(errMessage(e, '删除失败'))
      setRetryAction(() => async () => {
        clearActionError()
        await handleDeleteConfirm()
      })
    } finally {
      setDeleteBusy(false)
    }
  }

  function cardActionsBusyFor(meta: ProjectMeta): boolean {
    return (
      pinBusyId === meta.id ||
      (renameBusy && renameTarget?.id === meta.id) ||
      (deleteBusy && deleteTarget?.id === meta.id)
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-svh bg-[#FAF8F5] font-mono text-neutral-900">
        <PATSetup onConnected={() => void loadLibrary()} />
      </div>
    )
  }

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-[#FAF8F5] font-mono text-neutral-900 selection:bg-neutral-200">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-[#FAF8F5] px-8 py-5">
        <span className="flex shrink-0 items-center gap-6">
          <Logo variant="solid" size={32} />
          <span className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <LayoutGrid size={18} strokeWidth={2} aria-hidden />
            项目库
          </span>
        </span>
        <div className="flex items-center gap-6 text-sm">
          <Link
            to="/library"
            className="inline-flex items-center gap-1.5 text-neutral-900 hover:text-neutral-600"
            title="素材库"
          >
            <Images size={18} strokeWidth={2} aria-hidden />
            素材库
          </Link>
          <span className="text-neutral-600">{headerUserLabel}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="text-neutral-900 underline decoration-neutral-400 underline-offset-4 hover:decoration-neutral-900"
          >
            退出
          </button>
          <Link
            to="/settings"
            title="API 密钥"
            className="inline-flex min-w-[2.5rem] items-center justify-center rounded px-3 py-2 font-mono text-lg leading-none text-[#5f7163] transition-colors hover:bg-[#ebe4e5]/60"
          >
            <Settings size={20} strokeWidth={2} color="currentColor" />
          </Link>
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-[1400px] flex-1 overflow-y-auto px-8 pb-16 pt-10 text-left">
        {loadPhase === 'error' && loadError ? (
          <div className="mb-10 rounded border border-red-200 bg-red-50/80 px-4 py-3 font-mono text-sm text-red-900">
            <p className="mb-3">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadLibrary()}
              className="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-800"
            >
              重试
            </button>
          </div>
        ) : null}

        {actionError ? (
          <div className="mb-6 rounded border border-red-200 bg-red-50/80 px-4 py-3 font-mono text-sm text-red-900">
            <p className="mb-3">{actionError}</p>
            <div className="flex flex-wrap gap-2">
              {retryAction ? (
                <button
                  type="button"
                  onClick={() => void retryAction()}
                  className="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-800"
                >
                  重试
                </button>
              ) : null}
              <button
                type="button"
                onClick={clearActionError}
                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-neutral-900 hover:bg-neutral-50"
              >
                关闭
              </button>
            </div>
          </div>
        ) : null}

        {loadPhase === 'idle' ? (
          <>
            <div className="mb-10">
              <NewProjectButton
                busy={createBusy}
                onClick={() => {
                  setNewModalKey((k) => k + 1)
                  setNewOpen(true)
                }}
              />
            </div>

            {pinnedProjects.length > 0 ? (
              <section className="mb-12">
                <p className="mb-4 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-neutral-400">
                  <Pin size={12} strokeWidth={2} aria-hidden /> Pinned
                </p>
                <ProjectGrid>
                  {pinnedProjects.map((p) => (
                    <ProjectCard
                      key={p.id}
                      meta={p}
                      actionsBusy={cardActionsBusyFor(p)}
                      pinBusy={pinBusyId === p.id}
                      onOpen={() => navigate(`/canvas/${p.id}`)}
                      onTogglePin={() => void handleTogglePin(p)}
                      onRename={() => setRenameTarget(p)}
                      onDelete={() => setDeleteTarget(p)}
                    />
                  ))}
                </ProjectGrid>
              </section>
            ) : null}

            <section>
              <h2 className="mb-4 font-mono text-sm font-medium text-neutral-800">Recent</h2>
              {recentProjects.length === 0 ? (
                <p className="font-mono text-sm text-neutral-500">暂无项目，点击上方新建。</p>
              ) : (
                <ProjectGrid>
                  {recentProjects.map((p) => (
                    <ProjectCard
                      key={p.id}
                      meta={p}
                      actionsBusy={cardActionsBusyFor(p)}
                      pinBusy={pinBusyId === p.id}
                      onOpen={() => navigate(`/canvas/${p.id}`)}
                      onTogglePin={() => void handleTogglePin(p)}
                      onRename={() => setRenameTarget(p)}
                      onDelete={() => setDeleteTarget(p)}
                    />
                  ))}
                </ProjectGrid>
              )}
            </section>
          </>
        ) : null}
      </main>

      <NewProjectModal
        key={newModalKey}
        open={newOpen}
        loading={createBusy}
        onClose={() => setNewOpen(false)}
        onCreate={(name) => void handleCreateProject(name)}
      />

      {renameTarget ? (
        <RenameProjectModal
          key={renameTarget.id}
          project={renameTarget}
          loading={renameBusy}
          onClose={() => setRenameTarget(null)}
          onConfirm={(name) => void handleRenameConfirm(name)}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteConfirmModal
          key={deleteTarget.id}
          project={deleteTarget}
          loading={deleteBusy}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void handleDeleteConfirm()}
        />
      ) : null}

      {loadPhase === 'loading' ? <LogoViewportLoading /> : null}
    </div>
  )
}
