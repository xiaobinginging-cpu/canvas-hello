import { nanoid } from 'nanoid'
import * as github from './github.ts'
import {
  capDisplaySize,
  centerWorldPositionInViewport,
  clientPointToWorldCanvas,
  readImageFileDimensions,
} from './canvasGeometry.ts'
import { persistCanvasNow } from './canvasPersist.ts'
import type { Image as CanvasImage } from '../types/image.ts'
import { useProjectStore } from '../store/useStore.ts'

const IMG_PREFIX = 'img-'

function assetFilenameFor(imgId: string, ext: string): string {
  return `${IMG_PREFIX}${imgId}.${ext}`
}

function normalizeExt(file: File): string {
  const raw = (file.name.split('.').pop() || 'png').toLowerCase()
  if (raw === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'webp', 'gif'].includes(raw)) return raw
  return 'png'
}

export function parseFilenameFromSrc(src: string): string {
  const trimmed = src.replace(/^assets\//, '').replace(/^\//, '')
  return trimmed || ''
}

const CASCADE_STEP_PX = 30

/**
 * Upload one or more images: optimistic canvas rows + GitHub commit with blobs.
 * Each new image is offset diagonally by (n×30, n×30) from anchor so batches and
 * repeated single uploads do not stack (n = existing count at start of upload + index in batch).
 */
export async function uploadFilesToCanvas(
  files: File[],
  options: {
    placement: 'center' | 'drop'
    canvasEl: HTMLElement | null
    /** Client coordinates for drop placement (first image anchor). */
    dropClient?: { x: number; y: number }
    /** Default `upload`; `reference` for image-gen reference slots. */
    imageSource?: CanvasImage['source']
  },
): Promise<string[]> {
  const imageFiles = files.filter((f) => f.type.startsWith('image/'))
  if (imageFiles.length === 0) return []

  const projectId = useProjectStore.getState().currentProjectId
  const meta = useProjectStore.getState().currentProjectMeta
  const canvas = useProjectStore.getState().currentProjectCanvas
  if (!projectId || !meta || !canvas) return []

  const canvasEl = options.canvasEl
  const addedIds: string[] = []
  const imageCountAtStart = canvas.images.length
  const { canvasPanX, canvasPanY, canvasScale } = useProjectStore.getState()

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i]
    const imgId = nanoid()
    const ext = normalizeExt(file)
    const filename = assetFilenameFor(imgId, ext)
    const src = `assets/${filename}`

    let naturalW = 1
    let naturalH = 1
    try {
      const dim = await readImageFileDimensions(file)
      naturalW = dim.w
      naturalH = dim.h
    } catch {
      /* fall through to default size */
    }

    const size = capDisplaySize(naturalW, naturalH, 600)

    const cascadeIndex = imageCountAtStart + i
    const stagger = cascadeIndex * CASCADE_STEP_PX
    let position: { x: number; y: number }
    if (options.placement === 'center' && canvasEl) {
      const base = centerWorldPositionInViewport(
        canvasEl,
        size.w,
        size.h,
        canvasPanX,
        canvasPanY,
        canvasScale,
      )
      position = { x: base.x + stagger, y: base.y + stagger }
    } else if (options.placement === 'drop' && canvasEl && options.dropClient) {
      const world = clientPointToWorldCanvas(
        options.dropClient.x,
        options.dropClient.y,
        canvasEl,
        canvasPanX,
        canvasPanY,
        canvasScale,
      )
      position = {
        x: world.x + stagger,
        y: world.y + stagger,
      }
    } else {
      position = { x: 40 + stagger, y: 40 + stagger }
    }

    const source = options.imageSource ?? 'upload'
    const newImage: CanvasImage = {
      id: imgId,
      src,
      position,
      size,
      source,
      metadata: {
        uploadedAt: Date.now(),
        originalFilename: file.name,
      },
      isLoading: true,
    }

    useProjectStore.getState().addImage(newImage)
    addedIds.push(imgId)

    try {
      await github.saveProject(
        projectId,
        useProjectStore.getState().currentProjectMeta!,
        useProjectStore.getState().currentProjectCanvas!,
        [{ name: filename, blob: file }],
      )

      const blobUrl = URL.createObjectURL(file)
      useProjectStore.getState().registerImageObjectUrl(imgId, blobUrl)

      useProjectStore.getState().patchImage(imgId, {
        isLoading: false,
        uploadError: undefined,
      })
      useProjectStore.getState().deleteUploadRetryBlob(imgId)
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : '上传失败'
      useProjectStore.getState().patchImage(imgId, {
        isLoading: false,
        uploadError: msg,
      })
      useProjectStore.getState().setUploadRetryBlob(imgId, file)
    }
  }

  return addedIds
}

/** Retry after failed upload (blob kept in store). */
export async function retryImageUpload(imageId: string): Promise<void> {
  const blob = useProjectStore.getState().uploadRetryBlobs.get(imageId)
  if (!blob) return

  const projectId = useProjectStore.getState().currentProjectId
  const img = useProjectStore.getState().currentProjectCanvas?.images.find((i) => i.id === imageId)
  if (!projectId || !img) return

  const filename = parseFilenameFromSrc(img.src)
  useProjectStore.getState().patchImage(imageId, { isLoading: true, uploadError: undefined })

  try {
    await github.saveProject(
      projectId,
      useProjectStore.getState().currentProjectMeta!,
      useProjectStore.getState().currentProjectCanvas!,
      [{ name: filename, blob }],
    )

    const url = URL.createObjectURL(blob)
    useProjectStore.getState().registerImageObjectUrl(imageId, url)
    useProjectStore.getState().patchImage(imageId, {
      isLoading: false,
      uploadError: undefined,
    })
    useProjectStore.getState().deleteUploadRetryBlob(imageId)
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : '上传失败'
    useProjectStore.getState().patchImage(imageId, {
      isLoading: false,
      uploadError: msg,
    })
  }
}

export async function deleteImageFromCanvas(imageId: string): Promise<void> {
  const projectId = useProjectStore.getState().currentProjectId
  if (!projectId) return

  useProjectStore.getState().revokeImageObjectUrl(imageId)
  useProjectStore.getState().deleteUploadRetryBlob(imageId)
  useProjectStore.getState().removeImage(imageId)

  await persistCanvasNow()
}

export async function deleteTextCardFromCanvas(textCardId: string): Promise<void> {
  const projectId = useProjectStore.getState().currentProjectId
  if (!projectId) return
  useProjectStore.getState().removeTextCard(textCardId)
  await persistCanvasNow()
}

export async function deleteVideoFromCanvas(videoId: string): Promise<void> {
  const projectId = useProjectStore.getState().currentProjectId
  if (!projectId) return

  useProjectStore.getState().revokeVideoObjectUrl(videoId)
  useProjectStore.getState().removeVideo(videoId)

  await persistCanvasNow()
}
