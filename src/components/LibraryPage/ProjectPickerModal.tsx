import { useEffect, useState } from 'react'
import * as github from '../../lib/github.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { ProjectMeta } from '../../types/project.ts'
import InlineSpinner from '../shared/InlineSpinner.tsx'

/**
 * 选择目标 project（库页「加入画布」用）。优先用 store 已有项目列表，空则拉取。
 * @param onPick 选中项目 id 回调。
 */
export default function ProjectPickerModal({
  count,
  busy = false,
  onPick,
  onClose,
}: {
  /** 将要加入的素材数量，用于按钮文案。 */
  count: number
  /** 加入进行中：确认按钮变灰禁用、防重复点击。 */
  busy?: boolean
  onPick: (project: ProjectMeta) => void
  onClose: () => void
}) {
  const storeProjects = useProjectStore((s) => s.projects)
  const [projects, setProjects] = useState<ProjectMeta[]>(storeProjects)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>(
    storeProjects.length > 0 ? 'idle' : 'loading',
  )
  const [error, setError] = useState<string | null>(null)
  const [chosenId, setChosenId] = useState<string | null>(null)

  useEffect(() => {
    if (storeProjects.length > 0) return
    let cancelled = false
    void (async () => {
      try {
        const list = await github.listProjects()
        if (cancelled) return
        setProjects(list)
        useProjectStore.getState().setProjects(list)
        setPhase('idle')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '加载项目失败')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [storeProjects.length])

  const sorted = [...projects].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-picker-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded border border-neutral-200 bg-white text-left">
        <div className="shrink-0 border-b border-neutral-200 px-5 py-4">
          <h2 id="project-picker-title" className="text-base font-medium text-neutral-900">
            加入哪个项目？
          </h2>
          <p className="mt-1 text-xs text-neutral-500">{count} 个素材将作为参考图加入所选项目画布</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {phase === 'loading' ? (
            <div className="flex items-center justify-center py-10 text-xs text-neutral-400">
              <InlineSpinner />
              <span className="ml-2">加载项目…</span>
            </div>
          ) : phase === 'error' ? (
            <p className="rounded border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
              {error}
            </p>
          ) : sorted.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">还没有项目。</p>
          ) : (
            <ul className="space-y-1">
              {sorted.map((p) => {
                const active = p.id === chosenId
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setChosenId(p.id)}
                      className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${
                        active
                          ? 'border-neutral-900 bg-neutral-100 text-neutral-900'
                          : 'border-transparent text-neutral-800 hover:border-neutral-200 hover:bg-neutral-50'
                      }`}
                    >
                      {p.pinned ? <span className="text-[10px]">📌</span> : null}
                      <span className="line-clamp-1 break-all">
                        {p.name.trim() || p.id.slice(0, 8)}
                      </span>
                      {active ? <span className="ml-auto text-xs">✓</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-neutral-200 px-5 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!chosenId || busy}
            onClick={() => {
              const p = projects.find((x) => x.id === chosenId)
              if (p) onPick(p)
            }}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <InlineSpinner /> : null}
            确认加入
          </button>
        </div>
      </div>
    </div>
  )
}
