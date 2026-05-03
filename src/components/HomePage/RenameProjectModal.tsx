import { useState } from 'react'
import type { ProjectMeta } from '../../types/project'
import InlineSpinner from '../shared/InlineSpinner.tsx'

export default function RenameProjectModal({
  project,
  onClose,
  onConfirm,
  loading,
}: {
  project: ProjectMeta
  onClose: () => void
  onConfirm: (name: string) => void | Promise<void>
  loading?: boolean
}) {
  const [name, setName] = useState(project.name)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (loading) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded border border-neutral-200 bg-white p-6 text-left shadow-none">
        <h2 className="mb-4 font-mono text-lg font-medium text-neutral-900">重命名</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          className="mb-6 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-sm outline-none ring-neutral-900 focus:ring-1 disabled:opacity-60"
          autoFocus
        />
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded border border-neutral-300 bg-white px-4 py-2 font-mono text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onConfirm(name.trim() || '未命名')}
            disabled={loading}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded border border-neutral-900 bg-neutral-900 px-4 py-2 font-mono text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <InlineSpinner /> : null}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
