/** Small monochrome spinner for buttons / inline states */
export default function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-900"
        aria-hidden
      />
      {label ? <span className="font-mono text-xs text-neutral-600">{label}</span> : null}
    </span>
  )
}
