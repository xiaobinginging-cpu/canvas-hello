import type { ProjectMeta } from '../../types/project'
import { formatRelativeTimeZh } from '../../lib/formatRelativeTime'
import InlineSpinner from '../shared/InlineSpinner.tsx'

export default function ProjectCard({
  meta,
  onOpen,
  onTogglePin,
  onRename,
  onDelete,
  actionsBusy,
  pinBusy,
}: {
  meta: ProjectMeta
  onOpen: () => void
  onTogglePin: () => void
  onRename: () => void
  onDelete: () => void
  actionsBusy?: boolean
  pinBusy?: boolean
}) {
  const preview = meta.name.trim().slice(0, 48) || meta.id.slice(0, 12)

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded border border-neutral-300 bg-white text-left transition-colors hover:bg-neutral-50"
      >
        <div
          className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-neutral-950 px-3"
          aria-hidden
        >
          <span className="line-clamp-3 break-all text-center font-mono text-sm leading-snug text-white">
            {preview}
          </span>
        </div>
        <div className="border-t border-neutral-200 px-3 py-3">
          <div className="truncate font-mono text-sm font-medium text-neutral-900">{meta.name}</div>
          <div className="mt-1 font-mono text-xs text-neutral-500">
            {formatRelativeTimeZh(meta.updatedAt)}
          </div>
        </div>
      </button>

      <div
        className={`pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 ${actionsBusy ? 'pointer-events-auto opacity-100' : ''}`}
      >
        <button
          type="button"
          title={meta.pinned ? '取消置顶' : '置顶'}
          disabled={actionsBusy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onTogglePin()
          }}
          className="pointer-events-auto inline-flex min-h-[2rem] min-w-[2rem] items-center justify-center rounded bg-white/95 px-2 py-1 font-mono text-sm text-neutral-900 ring-1 ring-neutral-300 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pinBusy ? <InlineSpinner /> : '📌'}
        </button>
        <button
          type="button"
          title="重命名"
          disabled={actionsBusy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRename()
          }}
          className="pointer-events-auto rounded bg-white/95 px-2 py-1 font-mono text-sm text-neutral-900 ring-1 ring-neutral-300 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✏️
        </button>
        <button
          type="button"
          title="删除"
          disabled={actionsBusy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}
          className="pointer-events-auto rounded bg-white/95 px-2 py-1 font-mono text-sm text-neutral-900 ring-1 ring-neutral-300 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗑️
        </button>
      </div>
    </div>
  )
}
