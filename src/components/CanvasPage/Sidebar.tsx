import { useMemo, useState } from 'react'
import { Images } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as github from '../../lib/github.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { ProjectMeta } from '../../types/project'
import NewProjectButton from '../HomePage/NewProjectButton.tsx'

function nowMs(): number {
  return Date.now()
}

export default function Sidebar({
  createBusy,
  onOpenNewModal,
}: {
  createBusy: boolean
  onOpenNewModal: () => void
}) {
  const navigate = useNavigate()
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const sidebarVisible = useProjectStore((s) => s.sidebarVisible)
  const updateProject = useProjectStore((s) => s.updateProject)

  const [pinBusyId, setPinBusyId] = useState<string | null>(null)

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

  async function handleTogglePin(meta: ProjectMeta): Promise<void> {
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
      const curId = useProjectStore.getState().currentProjectId
      if (curId === meta.id) {
        useProjectStore.setState({ currentProjectMeta: next })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setPinBusyId(null)
    }
  }

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] duration-150 ease-out ${
        sidebarVisible ? 'w-56' : 'w-0 overflow-hidden border-r-0'
      }`}
    >
      <div className={`flex min-h-0 flex-1 flex-col gap-4 p-3 ${sidebarVisible ? '' : 'invisible'}`}>
        <NewProjectButton busy={createBusy} onClick={onOpenNewModal} />

        {pinnedProjects.length > 0 ? (
          <section className="min-h-0">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-neutral-400">📌 Pinned</p>
            <ul className="space-y-1">
              {pinnedProjects.map((p) => (
                <SidebarProjectRow
                  key={p.id}
                  meta={p}
                  active={p.id === currentProjectId}
                  pinBusy={pinBusyId === p.id}
                  onOpen={() => navigate(`/canvas/${p.id}`)}
                  onTogglePin={() => void handleTogglePin(p)}
                />
              ))}
            </ul>
          </section>
        ) : null}

        <section className="min-h-0 flex-1 overflow-y-auto">
          <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-neutral-400">
            Recent
          </p>
          {recentProjects.length === 0 && pinnedProjects.length === 0 ? (
            <p className="font-mono text-xs text-neutral-500">暂无项目</p>
          ) : (
            <ul className="space-y-1">
              {recentProjects.map((p) => (
                <SidebarProjectRow
                  key={p.id}
                  meta={p}
                  active={p.id === currentProjectId}
                  pinBusy={pinBusyId === p.id}
                  onOpen={() => navigate(`/canvas/${p.id}`)}
                  onTogglePin={() => void handleTogglePin(p)}
                />
              ))}
            </ul>
          )}
        </section>

        <div className="mt-auto flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => navigate('/library')}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded border border-neutral-300 bg-white py-2 font-mono text-xs text-neutral-800 hover:bg-neutral-50"
          >
            <Images size={14} strokeWidth={2} aria-hidden />
            素材库
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="shrink-0 rounded border border-neutral-300 bg-white py-2 font-mono text-xs text-neutral-800 hover:bg-neutral-50"
          >
            → 返回项目库
          </button>
        </div>
      </div>
    </aside>
  )
}

function SidebarProjectRow({
  meta,
  active,
  pinBusy,
  onOpen,
  onTogglePin,
}: {
  meta: ProjectMeta
  active: boolean
  pinBusy: boolean
  onOpen: () => void
  onTogglePin: () => void
}) {
  const label = meta.name.trim() || meta.id.slice(0, 8)

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className={`w-full rounded border px-2 py-1.5 pr-8 text-left font-mono text-xs transition-colors ${
          active
            ? 'border-neutral-900 bg-neutral-100 text-neutral-900'
            : 'border-transparent text-neutral-800 hover:border-neutral-200 hover:bg-neutral-50'
        }`}
      >
        <span className="line-clamp-2 break-all">{label}</span>
      </button>
      <button
        type="button"
        title={meta.pinned ? '取消置顶' : '置顶'}
        disabled={pinBusy}
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 font-mono text-xs opacity-0 transition-opacity hover:bg-neutral-200 group-hover:opacity-100 disabled:opacity-30"
      >
        {pinBusy ? '…' : '📌'}
      </button>
    </li>
  )
}
