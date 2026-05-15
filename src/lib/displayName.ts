const STORAGE_KEY = 'canvas-hello.display-name'

export const DISPLAY_NAME_CHANGED_EVENT = 'canvas-hello-display-name-changed'

export function getDisplayName(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  } catch {
    /* ignore */
  }
  return null
}

export function setDisplayName(value: string): void {
  try {
    const t = value.trim()
    if (!t) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, t)
    window.dispatchEvent(new Event(DISPLAY_NAME_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}
