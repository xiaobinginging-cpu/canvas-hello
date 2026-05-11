import { useId } from 'react'
import { LOGO_PATH_SOLID } from './logoPaths.ts'

export default function LogoLoading({
  size = 20,
  label,
  className = '',
  /** When false, omit role/live region (e.g. parent `LogoViewportLoading` announces) */
  announce = true,
}: {
  size?: number
  label?: string
  className?: string
  announce?: boolean
}) {
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      {...(announce ? { role: 'status' as const, 'aria-live': 'polite' as const } : {})}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="block shrink-0 overflow-visible"
        aria-hidden
      >
        <defs>
          <clipPath id={clipId}>
            <path d={LOGO_PATH_SOLID} />
          </clipPath>
        </defs>
        <path d={LOGO_PATH_SOLID} fill="var(--cedar)" />
        <g clipPath={`url(#${clipId})`}>
          <circle cx={28} cy={50} r={3} fill="#fff" className="logo-load-dot1" />
          <circle cx={38} cy={50} r={3} fill="#fff" className="logo-load-dot2" />
          <circle cx={48} cy={50} r={3} fill="#fff" className="logo-load-dot3" />
        </g>
      </svg>
      {label ? <span className="font-mono text-xs text-neutral-600">{label}</span> : null}
    </span>
  )
}
