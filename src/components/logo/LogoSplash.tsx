import { useEffect, useState } from 'react'
import { LOGO_PATH_SOLID } from './logoPaths.ts'

const STORAGE_KEY = 'canvas-hello-logo-splash-seen'
/** Stamps ~1050ms; dot waves 650ms×2 → 2350ms; then overlay fade */
const SPLASH_MS = 2350
const FADE_MS = 160

function initialSplashPhase(): 'hidden' | 'playing' {
  try {
    return localStorage.getItem(STORAGE_KEY) ? 'hidden' : 'playing'
  } catch {
    return 'hidden'
  }
}

export default function LogoSplash({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<'hidden' | 'playing' | 'fading'>(initialSplashPhase)

  useEffect(() => {
    if (phase !== 'playing') return
    const t = window.setTimeout(() => setPhase('fading'), SPLASH_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase !== 'fading') return
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, '1')
      } catch {
        /* ignore */
      }
      setPhase('hidden')
    }, FADE_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  if (phase === 'hidden') {
    return <>{children}</>
  }

  return (
    <>
      {children}
      <div
        className={`fixed inset-0 z-[9999] flex items-center justify-center bg-[#FAF8F5] transition-opacity ease-in-out ${
          phase === 'fading' ? 'opacity-0 duration-[160ms]' : 'opacity-100 duration-0'
        }`}
        aria-hidden
      >
        <svg
          width={112}
          height={112}
          viewBox="0 0 100 100"
          className="block overflow-visible"
          aria-hidden
        >
          <path
            pathLength={100}
            d={LOGO_PATH_SOLID}
            fill="none"
            stroke="var(--cedar)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="logo-splash-v2-main"
          />
          <circle cx={28} cy={50} r={3} fill="var(--cedar)" className="logo-splash-v2-dot1" />
          <circle cx={38} cy={50} r={3} fill="var(--cedar)" className="logo-splash-v2-dot2" />
          <circle cx={48} cy={50} r={3} fill="var(--cedar)" className="logo-splash-v2-dot3" />
        </svg>
      </div>
    </>
  )
}
