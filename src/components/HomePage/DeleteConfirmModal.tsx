import type { ProjectMeta } from '../../types/project'
import InlineSpinner from '../shared/InlineSpinner.tsx'

export default function DeleteConfirmModal({
  project,
  onClose,
  onConfirm,
  loading,
}: {
  project: ProjectMeta
  onClose: () => void
  onConfirm: () => void | Promise<void>
  loading?: boolean
}) {
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
        <p className="mb-6 font-mono text-sm leading-relaxed text-neutral-800">
          确认删除项目 <span className="font-medium text-neutral-900">{project.name}</span>？
        </p>
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
            onClick={() => void onConfirm()}
            disabled={loading}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded border border-red-800 bg-red-800 px-4 py-2 font-mono text-sm text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <InlineSpinner /> : null}
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
