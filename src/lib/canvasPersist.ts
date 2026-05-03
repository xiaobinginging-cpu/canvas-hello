import * as github from './github.ts'
import { useProjectStore } from '../store/useStore.ts'

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Writes current canvas + meta (with fresh `updatedAt`) to GitHub. No new asset blobs. */
export async function persistCanvasNow(): Promise<void> {
  const state = useProjectStore.getState()
  const projectId = state.currentProjectId
  const meta = state.currentProjectMeta
  const canvas = state.currentProjectCanvas
  if (!projectId || !meta || !canvas) return

  const now = Date.now()
  const nextMeta = { ...meta, updatedAt: now }
  useProjectStore.setState({ currentProjectMeta: nextMeta })
  useProjectStore.getState().updateProject(projectId, { updatedAt: now })

  const latest = useProjectStore.getState()
  await github.saveProject(
    projectId,
    latest.currentProjectMeta!,
    latest.currentProjectCanvas!,
    [],
  )
}

/** Debounced persist after drag — avoids GitHub commit per drag frame. */
export function schedulePersistCanvas(projectId: string, delayMs = 500): void {
  const prev = debounceTimers.get(projectId)
  if (prev !== undefined) clearTimeout(prev)
  debounceTimers.set(
    projectId,
    setTimeout(() => {
      debounceTimers.delete(projectId)
      void persistCanvasNow()
    }, delayMs),
  )
}
