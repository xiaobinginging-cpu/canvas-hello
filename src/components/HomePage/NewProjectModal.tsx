import { useState } from 'react'
import InlineSpinner from '../shared/InlineSpinner.tsx'

export default function NewProjectModal({
  open,
  onClose,
  onCreate,
  loading,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => void | Promise<void>
  loading?: boolean
}) {
  const [name, setName] = useState('')

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      onMouseDown={(e) => {
        if (loading) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded border border-neutral-200 bg-white p-6 text-left shadow-none">
        <h2 id="new-project-title" className="mb-4 font-mono text-lg font-medium text-neutral-900">
          新建项目
        </h2>
        <label className="mb-2 block font-mono text-xs text-neutral-500">名称</label>
        <input
          type="text"
          placeholder="未命名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          className="mb-6 w-full rounded border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-neutral-900 focus:ring-1 disabled:opacity-60"
          autoFocus
        />
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded border border-neutral-300 bg-white px-4 py-2 font-mono text-sm text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onCreate(name)}
            disabled={loading}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded border border-neutral-900 bg-neutral-900 px-4 py-2 font-mono text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <InlineSpinner /> : null}
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
