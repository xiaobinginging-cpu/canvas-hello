const PATH_D = 'M 84.64 30 A 40 40 0 1 0 84.64 70 L 65 50 Z'

export default function Logo({
  size = 24,
  color = '#222',
  variant = 'outline',
}: {
  size?: number
  color?: string
  variant?: 'outline' | 'solid'
}) {
  if (variant === 'outline') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        aria-hidden
      >
        <path
          d={PATH_D}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
        />
        <circle cx={38} cy={50} r={2} fill={color} />
        <circle cx={46} cy={50} r={2} fill={color} />
        <circle cx={54} cy={50} r={2} fill={color} />
      </svg>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden
    >
      <path d={PATH_D} fill={color} />
      <circle cx={38} cy={50} r={3} fill="#fff" />
      <circle cx={46} cy={50} r={3} fill="#fff" />
      <circle cx={54} cy={50} r={3} fill="#fff" />
    </svg>
  )
}
