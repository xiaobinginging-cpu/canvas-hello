import { create } from 'zustand'
import type { PromptGenAPI, PromptGenModel } from '../lib/promptGen.ts'
import type { Image } from '../types/image.ts'
import type { CanvasData, ProjectMeta, TextCard, VideoItem } from '../types/project'
import type { APImartVideoModel, VideoQuality } from '../types/video.ts'
import { getGithubLogin, isAuthenticated as ghIsAuthenticated } from '../lib/github'

export type CanvasSelectedTool =
  | 'cursor'
  | 'upload'
  | 'image-gen'
  | 'video-gen'
  | 'prompt-gen'
  | 'text-card'

/** Aspect ratios supported in image-gen UI (Gemini imageConfig.aspectRatio). */
export type ImageGenRatio =
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '5:4'
  | '4:5'
  | '1:1'
  | '21:9'

export type ImageGenResolution = '1K' | '2K' | '4K'

/** Image generator floating panel form state (not persisted). */
export interface ImageGenFormConfig {
  prompt: string
  api: 'google' | 'apimart'
  model: string
  ratio: ImageGenRatio
  /** Short-edge tier: 1K=1024px, 2K=2048px, 4K=4096px */
  resolution: ImageGenResolution
  count: 1 | 2 | 4
  referenceImageIds: string[]
}

export const DEFAULT_IMAGE_GEN_CONFIG: ImageGenFormConfig = {
  prompt: '',
  api: 'google',
  model: 'gemini-3.1-flash-image-preview',
  ratio: '1:1',
  resolution: '2K',
  count: 1,
  referenceImageIds: [],
}

export type VideoGenRatio = '16:9' | '9:16' | '1:1'

export interface VideoGenFormConfig {
  prompt: string
  model: APImartVideoModel
  ratio: VideoGenRatio
  /** 分辨率档位；各模型 API 映射见 apimartVideoGen。 */
  quality: VideoQuality
  duration: number
  referenceImageIds: string[]
}

export const DEFAULT_VIDEO_GEN_CONFIG: VideoGenFormConfig = {
  prompt: '',
  model: 'grok-imagine-1.0-video-apimart',
  ratio: '16:9',
  quality: '720p',
  duration: 6,
  referenceImageIds: [],
}

/** 提示词生成器表单（API/model 在会话内 sticky；不入库）。 */
export interface PromptGenFormConfig {
  api: PromptGenAPI
  model: PromptGenModel
  /** 自定义 instruction；空串表示使用服务端默认文案 */
  instruction: string
}

export const DEFAULT_PROMPT_GEN_CONFIG: PromptGenFormConfig = {
  api: 'google',
  model: 'gemini-3.1-flash-lite-preview',
  instruction: '',
}

export interface ProjectStoreState {
  projects: ProjectMeta[]
  isAuthenticated: boolean
  githubLogin: string | null
  setProjects: (projects: ProjectMeta[]) => void
  addProject: (project: ProjectMeta) => void
  updateProject: (id: string, patch: Partial<ProjectMeta>) => void
  removeProject: (id: string) => void
  /** Sync `isAuthenticated` / `githubLogin` from `src/lib/github` + optional login cache */
  syncAuthFromGithub: () => void
  setAuthAfterLogin: () => void
  clearAuth: () => void

  /** Active canvas route (null when not on canvas or after clear). */
  currentProjectId: string | null
  currentProjectMeta: ProjectMeta | null
  currentProjectCanvas: CanvasData | null
  sidebarVisible: boolean
  selectedTool: CanvasSelectedTool
  setCurrentProject: (p: { id: string; meta: ProjectMeta; canvas: CanvasData }) => void
  clearCurrentProject: () => void
  toggleSidebar: () => void
  setSelectedTool: (t: CanvasSelectedTool) => void

  selectedImageId: string | null
  /** Display URLs (`URL.createObjectURL`) keyed by image id — not persisted. */
  imageObjectUrls: Map<string, string>
  /** Display URLs for canvas videos — not persisted. */
  videoObjectUrls: Map<string, string>
  uploadRetryBlobs: Map<string, Blob>

  selectedVideoId: string | null
  setSelectedVideo: (id: string | null) => void
  setSelectedImage: (id: string | null) => void
  clearSelection: () => void
  addImage: (image: Image) => void
  patchImage: (id: string, patch: Partial<Image>) => void
  updateImagePosition: (id: string, position: { x: number; y: number }) => void
  /** Drag-only: updates canvas coordinates without bumping project metadata. */
  patchImagePositionLive: (id: string, position: { x: number; y: number }) => void
  removeImage: (id: string) => void
  addVideo: (video: VideoItem) => void
  patchVideo: (id: string, patch: Partial<VideoItem>) => void
  updateVideoBounds: (
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void
  /** Drag/resize-only: updates canvas bounds without bumping project metadata. */
  patchVideoBoundsLive: (
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => void
  removeVideo: (id: string) => void
  registerImageObjectUrl: (imageId: string, url: string) => void
  revokeImageObjectUrl: (imageId: string) => void
  revokeAllImageObjectUrls: () => void
  registerVideoObjectUrl: (videoId: string, url: string) => void
  revokeVideoObjectUrl: (videoId: string) => void
  setUploadRetryBlob: (imageId: string, blob: Blob) => void
  deleteUploadRetryBlob: (imageId: string) => void

  /** Image detail modal on canvas (ⓘ). */
  detailCardImageId: string | null
  openDetailCard: (imageId: string) => void
  closeDetailCard: () => void

  /** Infinite canvas viewport (screen-space pan + scale). World = (screen - pan) / scale. */
  canvasPanX: number
  canvasPanY: number
  canvasScale: number
  setCanvasPan: (x: number, y: number) => void
  /** Zoom toward a fixed point in viewport coordinates (relative to viewport top-left). */
  setCanvasZoomAtPoint: (nextScale: number, viewportX: number, viewportY: number) => void
  /** Zoom in/out toward viewport point; step size is derived from current scale (sign of deltaScale only). */
  nudgeCanvasZoom: (deltaScale: number, viewportX: number, viewportY: number) => void
  resetCanvasView: () => void
  fitCanvasToImages: (viewportWidth: number, viewportHeight: number) => void

  /** Viewport dot grid (localStorage). */
  showCanvasDots: boolean
  setShowCanvasDots: (v: boolean) => void
  toggleShowCanvasDots: () => void

  imageGenPanelOpen: boolean
  imageGenConfig: ImageGenFormConfig
  setImageGenPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  updateImageGenConfig: (patch: Partial<ImageGenFormConfig>) => void
  resetImageGenConfig: () => void

  videoGenPanelOpen: boolean
  videoGenConfig: VideoGenFormConfig
  setVideoGenPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  updateVideoGenConfig: (patch: Partial<VideoGenFormConfig>) => void
  resetVideoGenConfig: () => void
  promptGenConfig: PromptGenFormConfig
  updatePromptGenConfig: (patch: Partial<PromptGenFormConfig>) => void
  resetPromptGenConfig: () => void
  /** 提示词模式下列表里选中的画布图片 id（顺序有意义）。 */
  promptGenImageIds: string[]
  togglePromptGenImageId: (imageId: string) => void
  clearPromptGenImageIds: () => void

  selectedTextCardId: string | null
  setSelectedTextCardId: (id: string | null) => void

  /** 新建文本卡后自动进入编辑（直到组件消费后清空）。 */
  pendingTextCardEditId: string | null
  setPendingTextCardEditId: (id: string | null) => void

  addTextCard: (card: TextCard) => void
  patchTextCard: (
    id: string,
    patch: Partial<Pick<TextCard, 'x' | 'y' | 'width' | 'height' | 'text' | 'baseFontSizePx'>>,
  ) => void
  removeTextCard: (id: string) => void

  /** In-canvas multi-select for image-gen / video-gen reference images (从画布选择). */
  isCanvasSelectionMode: boolean
  /** 合并参考图时写入 image-gen / video-gen / prompt-gen 表单。 */
  canvasReferenceTarget: 'image-gen' | 'video-gen' | 'prompt-gen' | null
  canvasSelectionIds: string[]
  enterCanvasSelectionMode: (target?: 'image-gen' | 'video-gen' | 'prompt-gen') => void
  toggleCanvasSelection: (imageId: string) => void
  commitCanvasSelection: () => void
  cancelCanvasSelection: () => void
}

/** Canvas zoom: world scale relative to viewport (1 = 100%). Min allows Lovart-style dense overviews. */
export const CANVAS_SCALE_MIN = 0.01
export const CANVAS_SCALE_MAX = 3

export function clampCanvasScale(s: number): number {
  return Math.min(CANVAS_SCALE_MAX, Math.max(CANVAS_SCALE_MIN, s))
}

/** Wheel / ± buttons: finer steps when zoomed out (<25%), coarser at normal+ zoom. */
export function zoomNudgeStep(currentScale: number): number {
  return currentScale < 0.25 ? 0.02 : 0.05
}

/**
 * Pure viewport zoom-at-point math (same as {@link ProjectStoreState.setCanvasZoomAtPoint}).
 * Used by Canvas wheel rAF path to avoid zustand updates every zoom tick.
 */
export function computeCanvasZoomAtPoint(
  panX: number,
  panY: number,
  scale: number,
  nextScale: number,
  viewportX: number,
  viewportY: number,
): { canvasPanX: number; canvasPanY: number; canvasScale: number } {
  const s = clampCanvasScale(nextScale)
  const wx = (viewportX - panX) / scale
  const wy = (viewportY - panY) / scale
  return {
    canvasScale: s,
    canvasPanX: viewportX - s * wx,
    canvasPanY: viewportY - s * wy,
  }
}

function sortProjectsList(list: ProjectMeta[]): ProjectMeta[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

const LS_SHOW_CANVAS_DOTS = 'canvas-hello.v1.showCanvasDots'

function readCanvasPrefBool(key: string, defaultValue: boolean): boolean {
  if (typeof localStorage === 'undefined') return defaultValue
  try {
    const v = localStorage.getItem(key)
    if (v === null) return defaultValue
    return v === '1' || v === 'true'
  } catch {
    return defaultValue
  }
}

function writeCanvasPrefBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  isAuthenticated: ghIsAuthenticated(),
  githubLogin: getGithubLogin(),

  currentProjectId: null,
  currentProjectMeta: null,
  currentProjectCanvas: null,
  sidebarVisible: true,
  selectedTool: 'cursor',

  selectedImageId: null,
  selectedVideoId: null,
  imageObjectUrls: new Map(),
  videoObjectUrls: new Map(),
  uploadRetryBlobs: new Map(),
  detailCardImageId: null,

  canvasPanX: 0,
  canvasPanY: 0,
  canvasScale: 1,

  showCanvasDots: readCanvasPrefBool(LS_SHOW_CANVAS_DOTS, true),

  setShowCanvasDots: (v) => {
    writeCanvasPrefBool(LS_SHOW_CANVAS_DOTS, v)
    set({ showCanvasDots: v })
  },
  toggleShowCanvasDots: () =>
    set((s) => {
      const v = !s.showCanvasDots
      writeCanvasPrefBool(LS_SHOW_CANVAS_DOTS, v)
      return { showCanvasDots: v }
    }),

  setCanvasPan: (x, y) => set({ canvasPanX: x, canvasPanY: y }),

  setCanvasZoomAtPoint: (nextScale, viewportX, viewportY) =>
    set((state) => {
      const { canvasPanX, canvasPanY, canvasScale } = computeCanvasZoomAtPoint(
        state.canvasPanX,
        state.canvasPanY,
        state.canvasScale,
        nextScale,
        viewportX,
        viewportY,
      )
      return { canvasPanX, canvasPanY, canvasScale }
    }),

  nudgeCanvasZoom: (deltaScale, viewportX, viewportY) => {
    const { canvasScale } = get()
    const dir = deltaScale >= 0 ? 1 : -1
    const step = zoomNudgeStep(canvasScale)
    get().setCanvasZoomAtPoint(canvasScale + dir * step, viewportX, viewportY)
  },

  resetCanvasView: () => set({ canvasPanX: 0, canvasPanY: 0, canvasScale: 1 }),

  imageGenPanelOpen: false,
  imageGenConfig: { ...DEFAULT_IMAGE_GEN_CONFIG },

  setImageGenPanelOpen: (open) =>
    set((state) => ({
      imageGenPanelOpen: typeof open === 'function' ? open(state.imageGenPanelOpen) : open,
    })),

  updateImageGenConfig: (patch) =>
    set((state) => ({
      imageGenConfig: { ...state.imageGenConfig, ...patch },
    })),

  resetImageGenConfig: () => set({ imageGenConfig: { ...DEFAULT_IMAGE_GEN_CONFIG } }),

  videoGenPanelOpen: false,
  videoGenConfig: { ...DEFAULT_VIDEO_GEN_CONFIG },
  setVideoGenPanelOpen: (open) =>
    set((state) => ({
      videoGenPanelOpen: typeof open === 'function' ? open(state.videoGenPanelOpen) : open,
    })),
  updateVideoGenConfig: (patch) =>
    set((state) => ({
      videoGenConfig: { ...state.videoGenConfig, ...patch },
    })),
  resetVideoGenConfig: () => set({ videoGenConfig: { ...DEFAULT_VIDEO_GEN_CONFIG } }),

  promptGenConfig: { ...DEFAULT_PROMPT_GEN_CONFIG },
  updatePromptGenConfig: (patch) =>
    set((state) => ({
      promptGenConfig: { ...state.promptGenConfig, ...patch },
    })),
  resetPromptGenConfig: () => set({ promptGenConfig: { ...DEFAULT_PROMPT_GEN_CONFIG } }),

  promptGenImageIds: [],
  togglePromptGenImageId: (imageId) =>
    set((state) => {
      const cur = state.promptGenImageIds
      const has = cur.includes(imageId)
      const next = has ? cur.filter((x) => x !== imageId) : [...cur, imageId]
      return { promptGenImageIds: next }
    }),
  clearPromptGenImageIds: () => set({ promptGenImageIds: [] }),

  selectedTextCardId: null,
  setSelectedTextCardId: (id) =>
    set((state) => ({
      selectedTextCardId: id,
      selectedImageId: id != null ? null : state.selectedImageId,
      selectedVideoId: id != null ? null : state.selectedVideoId,
      detailCardImageId: null,
    })),

  pendingTextCardEditId: null,
  setPendingTextCardEditId: (id) => set({ pendingTextCardEditId: id }),

  addTextCard: (card) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const textCards = [...(s.currentProjectCanvas.textCards ?? []), card]
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, textCards },
      currentProjectMeta: nextMeta,
      selectedTextCardId: card.id,
      selectedImageId: null,
      selectedVideoId: null,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  patchTextCard: (id, patch) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const textCards = (s.currentProjectCanvas.textCards ?? []).map((t) =>
      t.id === id ? { ...t, ...patch } : t,
    )
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, textCards },
      currentProjectMeta: nextMeta,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  removeTextCard: (id) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const textCards = (s.currentProjectCanvas.textCards ?? []).filter((t) => t.id !== id)
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, textCards },
      currentProjectMeta: nextMeta,
      selectedTextCardId: s.selectedTextCardId === id ? null : s.selectedTextCardId,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  isCanvasSelectionMode: false,
  canvasReferenceTarget: null,
  canvasSelectionIds: [],

  enterCanvasSelectionMode: (target: 'image-gen' | 'video-gen' | 'prompt-gen' = 'image-gen') =>
    set({
      isCanvasSelectionMode: true,
      canvasReferenceTarget: target,
      canvasSelectionIds: [],
      selectedImageId: null,
      selectedVideoId: null,
      detailCardImageId: null,
    }),

  toggleCanvasSelection: (imageId) =>
    set((state) => {
      const cur = state.canvasSelectionIds
      const has = cur.includes(imageId)
      const next = has ? cur.filter((x) => x !== imageId) : [...cur, imageId]
      return { canvasSelectionIds: next }
    }),

  commitCanvasSelection: () => {
    const s = get()
    const target = s.canvasReferenceTarget ?? 'image-gen'
    if (target === 'prompt-gen') {
      const merged = [...new Set([...s.promptGenImageIds, ...s.canvasSelectionIds])]
      set({
        promptGenImageIds: merged,
        isCanvasSelectionMode: false,
        canvasSelectionIds: [],
        canvasReferenceTarget: null,
      })
      return
    }
    const merged = [
      ...new Set([
        ...(target === 'video-gen'
          ? s.videoGenConfig.referenceImageIds
          : s.imageGenConfig.referenceImageIds),
        ...s.canvasSelectionIds,
      ]),
    ]
    if (target === 'video-gen') {
      set({
        videoGenConfig: { ...s.videoGenConfig, referenceImageIds: merged },
        isCanvasSelectionMode: false,
        canvasSelectionIds: [],
        canvasReferenceTarget: null,
      })
    } else {
      set({
        imageGenConfig: { ...s.imageGenConfig, referenceImageIds: merged },
        isCanvasSelectionMode: false,
        canvasSelectionIds: [],
        canvasReferenceTarget: null,
      })
    }
  },

  cancelCanvasSelection: () =>
    set({ isCanvasSelectionMode: false, canvasSelectionIds: [], canvasReferenceTarget: null }),

  fitCanvasToImages: (viewportWidth, viewportHeight) => {
    const canvas = get().currentProjectCanvas
    if (!canvas) {
      set({ canvasPanX: 0, canvasPanY: 0, canvasScale: 1 })
      return
    }
    const cards = canvas.textCards ?? []
    const vids = canvas.videos ?? []
    if (!canvas.images.length && !vids.length && cards.length === 0) {
      set({ canvasPanX: 0, canvasPanY: 0, canvasScale: 1 })
      return
    }
    const pad = 80
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const im of canvas.images) {
      minX = Math.min(minX, im.position.x)
      minY = Math.min(minY, im.position.y)
      maxX = Math.max(maxX, im.position.x + im.size.w)
      maxY = Math.max(maxY, im.position.y + im.size.h)
    }
    for (const v of vids) {
      minX = Math.min(minX, v.x)
      minY = Math.min(minY, v.y)
      maxX = Math.max(maxX, v.x + v.width)
      maxY = Math.max(maxY, v.y + v.height)
    }
    for (const tc of cards) {
      minX = Math.min(minX, tc.x)
      minY = Math.min(minY, tc.y)
      maxX = Math.max(maxX, tc.x + tc.width)
      maxY = Math.max(maxY, tc.y + tc.height)
    }
    const cw = maxX - minX + pad * 2
    const ch = maxY - minY + pad * 2
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    let s = Math.min(viewportWidth / cw, viewportHeight / ch, CANVAS_SCALE_MAX)
    s = Math.max(CANVAS_SCALE_MIN, s)
    const panX = viewportWidth / 2 - s * cx
    const panY = viewportHeight / 2 - s * cy
    set({ canvasScale: s, canvasPanX: panX, canvasPanY: panY })
  },

  openDetailCard: (imageId) => set({ detailCardImageId: imageId }),

  closeDetailCard: () => set({ detailCardImageId: null }),

  setSelectedVideo: (id) =>
    set((state) => ({
      selectedVideoId: id,
      selectedImageId: id != null ? null : state.selectedImageId,
      selectedTextCardId: null,
      detailCardImageId: null,
    })),

  setSelectedImage: (id) =>
    set((state) => ({
      selectedImageId: id,
      selectedVideoId: id != null ? null : state.selectedVideoId,
      selectedTextCardId: id != null ? null : state.selectedTextCardId,
      detailCardImageId:
        id != null && id === state.detailCardImageId ? state.detailCardImageId : null,
    })),

  clearSelection: () =>
    set({
      selectedImageId: null,
      selectedVideoId: null,
      detailCardImageId: null,
      selectedTextCardId: null,
      pendingTextCardEditId: null,
    }),

  addImage: (image) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const nextCanvas: CanvasData = {
      ...s.currentProjectCanvas,
      images: [...s.currentProjectCanvas.images, image],
    }
    set({
      currentProjectCanvas: nextCanvas,
      currentProjectMeta: nextMeta,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  patchImage: (id, patch) => {
    const s = get()
    if (!s.currentProjectCanvas) return
    const images = s.currentProjectCanvas.images.map((im) =>
      im.id === id ? { ...im, ...patch } : im,
    )
    set({ currentProjectCanvas: { ...s.currentProjectCanvas, images } })
  },

  updateImagePosition: (id, position) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const images = s.currentProjectCanvas.images.map((im) =>
      im.id === id ? { ...im, position } : im,
    )
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, images },
      currentProjectMeta: nextMeta,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  patchImagePositionLive: (id, position) => {
    const s = get()
    if (!s.currentProjectCanvas) return
    const images = s.currentProjectCanvas.images.map((im) =>
      im.id === id ? { ...im, position } : im,
    )
    set({ currentProjectCanvas: { ...s.currentProjectCanvas, images } })
  },

  removeImage: (id) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const images = s.currentProjectCanvas.images.filter((im) => im.id !== id)
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, images },
      currentProjectMeta: nextMeta,
      selectedImageId: s.selectedImageId === id ? null : s.selectedImageId,
      detailCardImageId: s.detailCardImageId === id ? null : s.detailCardImageId,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  addVideo: (video) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const videos = [...(s.currentProjectCanvas.videos ?? []), video]
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, videos },
      currentProjectMeta: nextMeta,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  patchVideo: (id, patch) => {
    const s = get()
    if (!s.currentProjectCanvas) return
    const videos = (s.currentProjectCanvas.videos ?? []).map((v) =>
      v.id === id ? { ...v, ...patch } : v,
    )
    set({ currentProjectCanvas: { ...s.currentProjectCanvas, videos } })
  },

  updateVideoBounds: (id, bounds) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const videos = (s.currentProjectCanvas.videos ?? []).map((v) =>
      v.id === id
        ? { ...v, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : v,
    )
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, videos },
      currentProjectMeta: nextMeta,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  patchVideoBoundsLive: (id, bounds) => {
    const s = get()
    if (!s.currentProjectCanvas) return
    const videos = (s.currentProjectCanvas.videos ?? []).map((v) =>
      v.id === id
        ? { ...v, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : v,
    )
    set({ currentProjectCanvas: { ...s.currentProjectCanvas, videos } })
  },

  removeVideo: (id) => {
    const s = get()
    if (!s.currentProjectId || !s.currentProjectMeta || !s.currentProjectCanvas) return
    const now = Date.now()
    const nextMeta = { ...s.currentProjectMeta, updatedAt: now }
    const videos = (s.currentProjectCanvas.videos ?? []).filter((v) => v.id !== id)
    set({
      currentProjectCanvas: { ...s.currentProjectCanvas, videos },
      currentProjectMeta: nextMeta,
      selectedVideoId: s.selectedVideoId === id ? null : s.selectedVideoId,
    })
    get().updateProject(s.currentProjectId, { updatedAt: now })
  },

  registerImageObjectUrl: (imageId, url) =>
    set((state) => {
      const prev = state.imageObjectUrls.get(imageId)
      if (prev) URL.revokeObjectURL(prev)
      const nextMap = new Map(state.imageObjectUrls)
      nextMap.set(imageId, url)
      return { imageObjectUrls: nextMap }
    }),

  revokeImageObjectUrl: (imageId) =>
    set((state) => {
      const url = state.imageObjectUrls.get(imageId)
      if (url) URL.revokeObjectURL(url)
      const nextMap = new Map(state.imageObjectUrls)
      nextMap.delete(imageId)
      return { imageObjectUrls: nextMap }
    }),

  revokeAllImageObjectUrls: () =>
    set((state) => {
      for (const u of state.imageObjectUrls.values()) URL.revokeObjectURL(u)
      return { imageObjectUrls: new Map() }
    }),

  registerVideoObjectUrl: (videoId, url) =>
    set((state) => {
      const prev = state.videoObjectUrls.get(videoId)
      if (prev) URL.revokeObjectURL(prev)
      const nextMap = new Map(state.videoObjectUrls)
      nextMap.set(videoId, url)
      return { videoObjectUrls: nextMap }
    }),

  revokeVideoObjectUrl: (videoId) =>
    set((state) => {
      const url = state.videoObjectUrls.get(videoId)
      if (url) URL.revokeObjectURL(url)
      const nextMap = new Map(state.videoObjectUrls)
      nextMap.delete(videoId)
      return { videoObjectUrls: nextMap }
    }),

  setUploadRetryBlob: (imageId, blob) =>
    set((state) => {
      const next = new Map(state.uploadRetryBlobs)
      next.set(imageId, blob)
      return { uploadRetryBlobs: next }
    }),

  deleteUploadRetryBlob: (imageId) =>
    set((state) => {
      const next = new Map(state.uploadRetryBlobs)
      next.delete(imageId)
      return { uploadRetryBlobs: next }
    }),

  setCurrentProject: (p) =>
    set((state) => {
      if (state.currentProjectId !== p.id) {
        for (const u of state.imageObjectUrls.values()) URL.revokeObjectURL(u)
        for (const u of state.videoObjectUrls.values()) URL.revokeObjectURL(u)
        return {
          currentProjectId: p.id,
          currentProjectMeta: p.meta,
          currentProjectCanvas: p.canvas,
          selectedImageId: null,
          selectedVideoId: null,
          detailCardImageId: null,
          canvasPanX: 0,
          canvasPanY: 0,
          canvasScale: 1,
          imageGenPanelOpen: false,
          imageGenConfig: { ...DEFAULT_IMAGE_GEN_CONFIG },
          videoGenPanelOpen: false,
          videoGenConfig: { ...DEFAULT_VIDEO_GEN_CONFIG },
          isCanvasSelectionMode: false,
          canvasReferenceTarget: null,
          canvasSelectionIds: [],
          promptGenConfig: { ...DEFAULT_PROMPT_GEN_CONFIG },
          promptGenImageIds: [],
          selectedTextCardId: null,
          pendingTextCardEditId: null,
          imageObjectUrls: new Map(),
          videoObjectUrls: new Map(),
          uploadRetryBlobs: new Map(),
        }
      }
      return {
        currentProjectId: p.id,
        currentProjectMeta: p.meta,
        currentProjectCanvas: p.canvas,
      }
    }),

  clearCurrentProject: () =>
    set((state) => {
      for (const u of state.imageObjectUrls.values()) URL.revokeObjectURL(u)
      for (const u of state.videoObjectUrls.values()) URL.revokeObjectURL(u)
        return {
          currentProjectId: null,
          currentProjectMeta: null,
          currentProjectCanvas: null,
          selectedImageId: null,
          selectedVideoId: null,
          detailCardImageId: null,
          canvasPanX: 0,
          canvasPanY: 0,
          canvasScale: 1,
          imageGenPanelOpen: false,
          imageGenConfig: { ...DEFAULT_IMAGE_GEN_CONFIG },
          videoGenPanelOpen: false,
          videoGenConfig: { ...DEFAULT_VIDEO_GEN_CONFIG },
          isCanvasSelectionMode: false,
          canvasReferenceTarget: null,
          canvasSelectionIds: [],
          promptGenConfig: { ...DEFAULT_PROMPT_GEN_CONFIG },
          promptGenImageIds: [],
          selectedTextCardId: null,
          pendingTextCardEditId: null,
          imageObjectUrls: new Map(),
          videoObjectUrls: new Map(),
          uploadRetryBlobs: new Map(),
        }
      }),

  toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),

  setSelectedTool: (t) => set({ selectedTool: t }),

  setProjects: (projects) => set({ projects: sortProjectsList(projects) }),

  addProject: (project) =>
    set({
      projects: sortProjectsList([...get().projects.filter((p) => p.id !== project.id), project]),
    }),

  updateProject: (id, patch) =>
    set({
      projects: sortProjectsList(
        get().projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      ),
    }),

  removeProject: (id) =>
    set({
      projects: get().projects.filter((p) => p.id !== id),
    }),

  syncAuthFromGithub: () =>
    set({
      isAuthenticated: ghIsAuthenticated(),
      githubLogin: getGithubLogin(),
    }),

  setAuthAfterLogin: () =>
    set({
      isAuthenticated: true,
      githubLogin: getGithubLogin(),
    }),

  clearAuth: () =>
    set((state) => {
      for (const u of state.imageObjectUrls.values()) URL.revokeObjectURL(u)
      for (const u of state.videoObjectUrls.values()) URL.revokeObjectURL(u)
      return {
        isAuthenticated: false,
        githubLogin: null,
        projects: [],
        currentProjectId: null,
        currentProjectMeta: null,
        currentProjectCanvas: null,
        sidebarVisible: true,
        selectedTool: 'cursor',
        selectedImageId: null,
        selectedVideoId: null,
        detailCardImageId: null,
        canvasPanX: 0,
        canvasPanY: 0,
        canvasScale: 1,
        imageGenPanelOpen: false,
        imageGenConfig: { ...DEFAULT_IMAGE_GEN_CONFIG },
        videoGenPanelOpen: false,
        videoGenConfig: { ...DEFAULT_VIDEO_GEN_CONFIG },
        isCanvasSelectionMode: false,
        canvasReferenceTarget: null,
        canvasSelectionIds: [],
        promptGenConfig: { ...DEFAULT_PROMPT_GEN_CONFIG },
        promptGenImageIds: [],
        selectedTextCardId: null,
        pendingTextCardEditId: null,
        imageObjectUrls: new Map(),
        videoObjectUrls: new Map(),
        uploadRetryBlobs: new Map(),
      }
    }),
}))

const ALL_IMAGE_GEN_RATIOS: readonly ImageGenRatio[] = [
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '1:1',
  '21:9',
]

/** Normalize ratio strings from persisted {@link ImageMetadata} into the image-gen UI union. */
export function coerceImageGenRatio(v: string | undefined): ImageGenRatio {
  return ALL_IMAGE_GEN_RATIOS.includes(v as ImageGenRatio) ? (v as ImageGenRatio) : '1:1'
}

/** Normalize resolution from metadata (defaults to 2K). */
export function coerceImageGenResolution(v: string | undefined): ImageGenResolution {
  return v === '1K' || v === '2K' || v === '4K' ? v : '2K'
}
