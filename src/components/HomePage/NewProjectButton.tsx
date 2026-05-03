import InlineSpinner from '../shared/InlineSpinner.tsx'

export default function NewProjectButton({
  onClick,
  disabled,
  busy,
}: {
  onClick: () => void
  disabled?: boolean
  busy?: boolean
}) {
  const isDisabled = disabled || busy
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className="inline-flex items-center justify-center gap-2 rounded border border-neutral-900 bg-neutral-900 px-5 py-3 font-mono text-sm text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? <InlineSpinner /> : null}
      + 新建项目
    </button>
  )
}
