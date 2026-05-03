/** localStorage persistence — implementation will evolve with v2 data model */
const PREFIX = 'canvas-v2'

export const STORAGE_KEYS = {
  projects: `${PREFIX}:projects`,
  activeProject: `${PREFIX}:active-project`,
} as const

export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore quota / private mode
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readRaw(key)
  if (raw == null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  writeRaw(key, JSON.stringify(value))
}
