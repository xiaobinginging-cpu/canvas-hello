import { useId } from 'react'
import { LOGO_PATH_SOLID } from './logo/logoPaths.ts'

export default function Logo({
  size = 24,
  color = 'var(--cedar)',
  variant = 'outline',
}: {
  size?: number
  color?: string
  variant?: 'outline' | 'solid'
}) {
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  if (variant === 'outline') {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
        <path
          d={LOGO_PATH_SOLID}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
        />
        <circle cx={28} cy={50} r={2} fill={color} />
        <circle cx={38} cy={50} r={2} fill={color} />
        <circle cx={48} cy={50} r={2} fill={color} />
      </svg>
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <path d={LOGO_PATH_SOLID} />
        </clipPath>
      </defs>
      <path d={LOGO_PATH_SOLID} fill={color} />
      <g clipPath={`url(#${clipId})`}>
        <circle cx={28} cy={50} r={3} fill="#fff" />
        <circle cx={38} cy={50} r={3} fill="#fff" />
        <circle cx={48} cy={50} r={3} fill="#fff" />
      </g>
    </svg>
  )
}
