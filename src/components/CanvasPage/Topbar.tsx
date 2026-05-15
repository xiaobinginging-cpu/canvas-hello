import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Eraser, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffectiveUserLabel } from '../../hooks/useEffectiveUserLabel.ts'
import * as github from '../../lib/github.ts'
import { useProjectStore } from '../../store/useStore.ts'
import Logo from '../Logo.tsx'

export default function Topbar() {
  const headerUserLabel = useEffectiveUserLabel()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const meta = useProjectStore((s) => s.currentProjectMeta)
  const canvas = useProjectStore((s) => s.currentProjectCanvas)
  const updateProject = useProjectStore((s) => s.updateProject)
  const sidebarVisible = useProjectStore((s) => s.sidebarVisible)
  const toggleSidebar = useProjectStore((s) => s.toggleSidebar)

  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEdit = useCallback(() => {
    if (!meta || renameBusy) return
    setDraftName(meta.name)
    setEditing(true)
  }, [meta, renameBusy])

  const cancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  const commitRename = useCallback(async () => {
    if (!projectId || !meta || !canvas || renameBusy) return
    const name = draftName.trim() || '未命名'
    if (name === meta.name) {
      setEditing(false)
      return
    }
    setRenameBusy(true)
    try {
      const now = Date.now()
      const next = { ...meta, name, updatedAt: now }
      await github.saveProject(projectId, next, canvas, [])
      updateProject(projectId, { name: next.name, updatedAt: next.updatedAt })
      useProjectStore.setState({ currentProjectMeta: next })
      setEditing(false)
    } catch (e) {
      console.error(e)
    } finally {
      setRenameBusy(false)
    }
  }, [projectId, meta, canvas, draftName, renameBusy, updateProject])

  const runCleanupOrphans = useCallback(async () => {
    if (!projectId || !meta || !canvas || cleanupBusy) return
    setCleanupBusy(true)
    try {
      const r = await github.cleanupOrphanCanvasAssets(projectId, meta, canvas)
      if (r.removedIds.length > 0) {
        for (const id of r.removedIds) {
          useProjectStore.getState().revokeImageObjectUrl(id)
        }
        useProjectStore.setState({
          currentProjectMeta: r.nextMeta,
          currentProjectCanvas: r.nextCanvas,
        })
        updateProject(projectId, { updatedAt: r.nextMeta.updatedAt })
        console.log(`[canvas/cleanup] removed ${r.removedIds.length} orphan(s)`)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCleanupBusy(false)
    }
  }, [projectId, meta, canvas, cleanupBusy, updateProject])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void commitRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEdit()
      }
    },
    [commitRename, cancelEdit],
  )

  const title = meta?.name ?? '…'

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-[#FAF8F5] px-4 py-3 font-mono">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          title={sidebarVisible ? '隐藏侧栏' : '显示侧栏'}
          onClick={toggleSidebar}
          className="shrink-0 rounded p-2 text-lg leading-none text-neutral-800 hover:bg-neutral-200/60"
        >
          {sidebarVisible ? '⟨' : '⟩'}
        </button>
        <span className="flex shrink-0 items-center">
          <Logo variant="outline" size={28} />
        </span>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftName}
            disabled={renameBusy}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => void commitRename()}
            className="min-w-0 max-w-md rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none ring-neutral-900 focus:ring-1"
          />
        ) : (
          <button
            type="button"
            title="双击重命名"
            onDoubleClick={startEdit}
            className="min-w-0 truncate text-left text-sm font-medium text-neutral-900 hover:text-neutral-700"
          >
            {title}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className="hidden max-w-[10rem] truncate text-sm text-neutral-600 sm:inline"
          title={headerUserLabel}
        >
          {headerUserLabel}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title="清理孤儿"
            disabled={!projectId || !meta || !canvas || cleanupBusy}
            onClick={() => void runCleanupOrphans()}
            className="inline-flex min-w-[2.5rem] items-center justify-center rounded px-3 py-2 font-mono text-lg leading-none text-[#222] transition-colors hover:bg-neutral-200/80 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
          >
            <Eraser size={20} strokeWidth={2} color="currentColor" />
          </button>
          <Link
            to="/settings"
            title="API 密钥"
            className="inline-flex min-w-[2.5rem] items-center justify-center rounded px-3 py-2 font-mono text-lg leading-none text-[#5f7163] transition-colors hover:bg-neutral-200/80"
          >
            <Settings size={20} strokeWidth={2} color="currentColor" />
          </Link>
        </div>
      </div>
    </header>
  )
}
