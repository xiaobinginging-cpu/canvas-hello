import { useEffect, useState } from 'react'
import { DISPLAY_NAME_CHANGED_EVENT, getDisplayName } from '../lib/displayName.ts'
import { useProjectStore } from '../store/useStore.ts'

function computeLabel(githubLogin: string | null): string {
  const d = getDisplayName()
  if (d) return d
  return githubLogin ?? '—'
}

/** `canvas-hello.display-name` if set, else GitHub login from store (same as header / topbar). */
export function useEffectiveUserLabel(): string {
  const githubLogin = useProjectStore((s) => s.githubLogin)
  const [label, setLabel] = useState(() => computeLabel(githubLogin))

  useEffect(() => {
    setLabel(computeLabel(githubLogin))
  }, [githubLogin])

  useEffect(() => {
    const sync = () => {
      setLabel(computeLabel(useProjectStore.getState().githubLogin))
    }
    window.addEventListener(DISPLAY_NAME_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(DISPLAY_NAME_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return label
}
