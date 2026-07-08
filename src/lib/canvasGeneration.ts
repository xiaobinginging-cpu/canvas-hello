import { nanoid } from 'nanoid'
import type { Image } from '../types/image.ts'
import type { VideoItem } from '../types/project.ts'
import type { APImartVideoModel, VideoModel, VideoQuality } from '../types/video.ts'
import { videoProviderForModel } from '../types/video.ts'
import {
  coerceApimartModelId,
  generateMidjourneyViaAPImart,
  generateViaAPImart,
  upscaleMidjourneyViaAPImart,
} from './apimartGen.ts'
import { generateVideoViaAPImart } from './apimartVideoGen.ts'
import { generateVideoViaDashScope } from './dashscopeVideoGen.ts'
import { generateOneImage, pixelSizeFromRatioAndResolution } from './ai.ts'
import { centerWorldPositionInViewport } from './canvasGeometry.ts'
import { persistCanvasNow } from './canvasPersist.ts'
import { parseFilenameFromSrc } from './canvasUpload.ts'
import * as github from './github.ts'
import { useProjectStore } from '../store/useStore.ts'
import type {
  ImageGenRatio,
  ImageGenResolution,
  VideoGenRatio,
} from '../store/useStore.ts'

const CASCADE_STEP = 30

const genAbort = new Map<string, AbortController>()

function assetFilenameForGeneratedImage(imageId: string, blob: Blob): string {
  const ext = blob.type.includes('jpeg') ? 'jpg' : 'png'
  return `img-${imageId}.${ext}`
}

function assetFilenameForGeneratedVideo(videoId: string): string {
  return `video-${videoId}.mp4`
}

function videoBoxFromRatio(ratio: VideoGenRatio): { w: number; h: number } {
  switch (ratio) {
    case '16:9':
      return { w: 640, h: 360 }
    case '9:16':
      return { w: 360, h: 640 }
    case '1:1':
      return { w: 480, h: 480 }
    default:
      return { w: 640, h: 360 }
  }
}

/** Update store + object URL only (no GitHub write). Caller commits assets. */
function patchStoreAfterGeneratedBlob(imageId: string, blob: Blob, assetFilename: string): boolean {
  if (!useProjectStore.getState().currentProjectCanvas?.images.some((im) => im.id === imageId)) {
    return false
  }
  const assetPath = `assets/${assetFilename}`
  const st0 = useProjectStore.getState()
  const prevMeta = st0.currentProjectCanvas!.images.find((im) => im.id === imageId)!.metadata

  st0.patchImage(imageId, {
    src: assetPath,
    isLoading: false,
    cancelable: false,
    uploadError: undefined,
    metadata: {
      ...prevMeta,
      generatedAt: Date.now(),
    },
  })

  const blobUrl = URL.createObjectURL(blob)
  useProjectStore.getState().registerImageObjectUrl(imageId, blobUrl)
  return true
}

async function blobForCanvasImageId(imageId: string): Promise<{ blob: Blob; mimeType: string } | null> {
  const state = useProjectStore.getState()
  const projectId = state.currentProjectId
  const img = state.currentProjectCanvas?.images.find((i) => i.id === imageId)
  if (!projectId || !img) return null

  const cached = state.imageObjectUrls.get(imageId)
  if (cached) {
    const res = await fetch(cached)
    const blob = await res.blob()
    return { blob, mimeType: blob.type || 'image/png' }
  }

  const fn = parseFilenameFromSrc(img.src)
  if (!fn || img.src === 'pending') return null
  try {
    const blob = await github.fetchAsset(projectId, fn)
    return { blob, mimeType: blob.type || 'image/png' }
  } catch {
    return null
  }
}

/** Same fetch rules as image-gen reference images; used by prompt-gen. */
export async function collectReferenceBlobs(
  ids: string[],
): Promise<{ blob: Blob; mimeType: string }[]> {
  const out: { blob: Blob; mimeType: string }[] = []
  for (const id of ids) {
    const b = await blobForCanvasImageId(id)
    if (b) out.push(b)
  }
  return out
}

export function cancelImageGeneration(imageId: string): void {
  const c = genAbort.get(imageId)
  if (c) {
    c.abort()
    genAbort.delete(imageId)
  }
  useProjectStore.getState().removeImage(imageId)
  void persistCanvasNow()
}

function patchStoreAfterGeneratedVideo(videoId: string, blob: Blob, assetFilename: string): boolean {
  const canvas = useProjectStore.getState().currentProjectCanvas
  if (!canvas?.videos?.some((v) => v.id === videoId)) {
    return false
  }
  const assetPath = `assets/${assetFilename}`
  useProjectStore.getState().patchVideo(videoId, {
    src: assetPath,
    isLoading: false,
    cancelable: false,
    uploadError: undefined,
    generatedAt: Date.now(),
  })
  const blobUrl = URL.createObjectURL(blob)
  useProjectStore.getState().registerVideoObjectUrl(videoId, blobUrl)
  return true
}

async function uploadGeneratedVideoBlob(
  projectId: string,
  videoId: string,
  blob: Blob,
  assetFilename: string,
): Promise<void> {
  if (!blob || blob.size === 0) {
    throw new Error(`empty video blob: ${assetFilename}`)
  }
  if (!patchStoreAfterGeneratedVideo(videoId, blob, assetFilename)) {
    genAbort.delete(videoId)
    return
  }

  console.log('[video/gen/finalize]', videoId, 'isLoading=false', `src=assets/${assetFilename}`)

  const st1 = useProjectStore.getState()
  if (st1.currentProjectId !== projectId || !st1.currentProjectMeta || !st1.currentProjectCanvas) {
    console.warn('[video/gen] project changed during generation, skip commit')
    genAbort.delete(videoId)
    return
  }
  await github.saveProject(projectId, st1.currentProjectMeta, st1.currentProjectCanvas, [
    { name: assetFilename, blob },
  ])
  genAbort.delete(videoId)
}

export function cancelVideoGeneration(videoId: string): void {
  genAbort.delete(videoId)
  useProjectStore.getState().revokeVideoObjectUrl(videoId)
  useProjectStore.getState().removeVideo(videoId)
  void persistCanvasNow()
}

function collectVideoReferenceRawUrls(projectId: string, referenceImageIds: string[]): string[] {
  const canvas = useProjectStore.getState().currentProjectCanvas
  if (!canvas) return []
  const urls: string[] = []
  for (const id of referenceImageIds) {
    const img = canvas.images.find((i) => i.id === id)
    if (!img) {
      throw new Error('[video/ref] 参考图已从画布移除')
    }
    if (img.isLoading || img.src === 'pending') {
      throw new Error('[video/ref] 参考图尚未保存到 GitHub，请等待完成后再试')
    }
    if (!img.src.startsWith('assets/')) {
      throw new Error('[video/ref] 仅支持已保存的资源路径（assets/…）')
    }
    urls.push(github.getRawAssetUrl(projectId, img.src))
  }
  return urls
}

export async function runCanvasVideoGeneration(params: {
  viewportEl: HTMLElement | null
  prompt: string
  model: VideoModel
  ratio: VideoGenRatio
  quality: VideoQuality
  duration: number
  referenceImageIds: string[]
}): Promise<void> {
  const { viewportEl, prompt, model, ratio, quality, duration, referenceImageIds } = params
  const promptTrim = prompt.trim()
  if (!promptTrim) return

  const state = useProjectStore.getState()
  const projectId = state.currentProjectId
  const meta = state.currentProjectMeta
  const canvas = state.currentProjectCanvas
  if (!projectId || !meta || !canvas) return

  const { canvasPanX, canvasPanY, canvasScale, addVideo } = state

  const provider = videoProviderForModel(model)
  // 百炼 HappyHorse 是 T2V（文生视频），不用参考图。
  const maxRef =
    provider === 'dashscope'
      ? 0
      : model === 'grok-imagine-1.0-video-apimart' || model === 'kling-v3'
        ? 7
        : 9
  const refIds = referenceImageIds.slice(0, maxRef)

  const baseSize = videoBoxFromRatio(ratio)
  const imageCountAtStart = canvas.images.length + (canvas.videos ?? []).length
  const stagger = imageCountAtStart * CASCADE_STEP
  let position = { x: 40 + stagger, y: 40 + stagger }
  if (viewportEl) {
    const center = centerWorldPositionInViewport(
      viewportEl,
      baseSize.w,
      baseSize.h,
      canvasPanX,
      canvasPanY,
      canvasScale,
    )
    position = { x: center.x + stagger, y: center.y + stagger }
  }

  const videoId = nanoid()

  const placeholder: VideoItem = {
    id: videoId,
    x: position.x,
    y: position.y,
    width: baseSize.w,
    height: baseSize.h,
    src: 'pending',
    duration,
    api: provider,
    model,
    prompt: promptTrim,
    ratio,
    videoQuality: quality,
    referenceImageIds: refIds.length ? [...refIds] : undefined,
    isLoading: true,
    cancelable: true,
  }

  addVideo(placeholder)

  let imageRawUrls: string[] | undefined
  if (provider === 'apimart' && refIds.length > 0) {
    try {
      imageRawUrls = collectVideoReferenceRawUrls(projectId, refIds)
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e)
      console.error('[video/gen] ref error →', details)
      useProjectStore.getState().patchVideo(videoId, {
        isLoading: false,
        cancelable: false,
        uploadError: details,
      })
      return
    }
  }

  try {
    const blobs =
      provider === 'dashscope'
        ? await generateVideoViaDashScope({
            model: 'happyhorse-1.0-t2v',
            prompt: promptTrim,
            ratio,
            duration,
            quality,
          })
        : await generateVideoViaAPImart({
            model: model as APImartVideoModel,
            prompt: promptTrim,
            size: ratio,
            duration,
            quality,
            imageRawUrls,
          })
    const blob = blobs[0]
    if (!blob || blob.size === 0) {
      throw new Error('[video] empty result')
    }
    const filename = assetFilenameForGeneratedVideo(videoId)
    await uploadGeneratedVideoBlob(projectId, videoId, blob, filename)
    console.log('[video/gen] all done')
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e)
    console.error('[video/gen] error →', details)
    genAbort.delete(videoId)
    useProjectStore.getState().patchVideo(videoId, {
      isLoading: false,
      cancelable: false,
      uploadError: details,
    })
  }
}

async function uploadGeneratedBlob(
  projectId: string,
  imageId: string,
  blob: Blob,
  assetFilename: string,
): Promise<void> {
  if (!blob || blob.size === 0) {
    throw new Error(`empty blob: ${assetFilename}`)
  }
  if (!patchStoreAfterGeneratedBlob(imageId, blob, assetFilename)) {
    genAbort.delete(imageId)
    return
  }

  console.log('[gen/finalize]', imageId, 'isLoading=false', `src=assets/${assetFilename}`)

  const st1 = useProjectStore.getState()
  if (st1.currentProjectId !== projectId || !st1.currentProjectMeta || !st1.currentProjectCanvas) {
    console.warn('[image/gen] project changed during generation, skip commit')
    genAbort.delete(imageId)
    return
  }
  await github.saveProject(projectId, st1.currentProjectMeta, st1.currentProjectCanvas, [
    { name: assetFilename, blob },
  ])
  genAbort.delete(imageId)
}

export async function retryCanvasImageGeneration(imageId: string): Promise<void> {
  const st = useProjectStore.getState()
  const projectId = st.currentProjectId
  const img = st.currentProjectCanvas?.images.find((i) => i.id === imageId)
  if (!projectId || !img || img.source !== 'generated') return
  const m = img.metadata
  const prompt = m.prompt?.trim()
  const model = m.model
  const ratio = (m.ratio ?? '1:1') as ImageGenRatio
  const resolution = (m.resolution ?? '2K') as ImageGenResolution
  const api = m.api ?? 'google'
  if (!prompt || !model) return

  st.patchImage(imageId, { isLoading: true, uploadError: undefined, cancelable: true })
  const ac = new AbortController()
  genAbort.set(imageId, ac)

  const refIds = m.referenceImageIds ?? []
  const refBlobs = refIds.length > 0 ? await collectReferenceBlobs(refIds) : undefined

  try {
    let blob: Blob
    if (api === 'apimart' && coerceApimartModelId(model) === 'midjourney') {
      // MJ 重试是重新生成一个任务、取第 1 张变体；新 taskId/序号刷进元数据，否则放大的还是旧任务
      const { blobs, taskId } = await generateMidjourneyViaAPImart({ prompt, size: ratio })
      const b = blobs[0]
      if (!b || b.size === 0) throw new Error('[mj] empty result on retry')
      blob = b
      const st2 = useProjectStore.getState()
      const prevMeta = st2.currentProjectCanvas?.images.find((i) => i.id === imageId)?.metadata
      if (prevMeta) st2.patchImage(imageId, { metadata: { ...prevMeta, mjTaskId: taskId, mjIndex: 1 } })
    } else if (api === 'apimart') {
      const imageBlobs = refBlobs?.map((r) => r.blob)
      const blobs = await generateViaAPImart({
        model: coerceApimartModelId(model),
        prompt,
        size: ratio,
        resolution,
        n: 1,
        imageBlobs,
      })
      const b = blobs[0]
      if (!b || b.size === 0) throw new Error('[apimart] empty result on retry')
      blob = b
    } else {
      blob = await generateOneImage(
        { prompt, model, ratio, resolution },
        { signal: ac.signal, referenceBlobs: refBlobs },
      )
    }
    const filename = assetFilenameForGeneratedImage(imageId, blob)
    console.log(`[image/gen] upload retry success path=assets/${filename}`)
    await uploadGeneratedBlob(projectId, imageId, blob, filename)
    console.log('[image/gen] all done')
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e)
    if (e instanceof Error && e.name === 'AbortError') {
      genAbort.delete(imageId)
      return
    }
    console.error('[image/gen] error →', details)
    genAbort.delete(imageId)
    st.patchImage(imageId, { isLoading: false, cancelable: false, uploadError: details })
  }
}

/** Midjourney 放大网格第 index 张：在源图右侧放占位卡 → upscale → 走常规落库。 */
export async function runMidjourneyUpscale(sourceImageId: string, index: 1 | 2 | 3 | 4): Promise<void> {
  const st = useProjectStore.getState()
  const projectId = st.currentProjectId
  const src = st.currentProjectCanvas?.images.find((i) => i.id === sourceImageId)
  const mjTaskId = src?.metadata.mjTaskId
  if (!projectId || !src || !mjTaskId) return

  const imgId = nanoid()
  const placeholder: Image = {
    id: imgId,
    src: 'pending',
    position: {
      x: src.position.x + src.size.w + 30,
      y: src.position.y + (index - 1) * CASCADE_STEP,
    },
    size: { w: src.size.w, h: src.size.h },
    source: 'generated',
    metadata: {
      prompt: src.metadata.prompt,
      api: 'apimart',
      model: 'midjourney',
      ratio: src.metadata.ratio,
      parents: [sourceImageId],
      generatedAt: Date.now(),
    },
    isLoading: true,
    cancelable: false,
  }
  st.addImage(placeholder)
  console.log(`[mj/upscale] start task=${mjTaskId} index=${index}`)

  try {
    const blob = await upscaleMidjourneyViaAPImart({ taskId: mjTaskId, index })
    if (!blob || blob.size === 0) throw new Error('[mj/upscale] empty result')
    const filename = assetFilenameForGeneratedImage(imgId, blob)
    await uploadGeneratedBlob(projectId, imgId, blob, filename)
    console.log('[mj/upscale] all done')
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e)
    console.error('[mj/upscale] error →', details)
    useProjectStore.getState().patchImage(imgId, {
      isLoading: false,
      cancelable: false,
      uploadError: details,
    })
  }
}

export async function runCanvasImageGeneration(params: {
  viewportEl: HTMLElement | null
  prompt: string
  model: string
  ratio: ImageGenRatio
  resolution: ImageGenResolution
  count: 1 | 2 | 4
  referenceImageIds: string[]
  api: 'google' | 'apimart'
}): Promise<void> {
  const { viewportEl, prompt, model, ratio, resolution, count, referenceImageIds, api } = params
  const promptTrim = prompt.trim()
  if (!promptTrim) return

  console.log('[gen/start]', { count, prompt: promptTrim.slice(0, 30) })

  const state = useProjectStore.getState()
  const projectId = state.currentProjectId
  const meta = state.currentProjectMeta
  const canvas = state.currentProjectCanvas
  if (!projectId || !meta || !canvas) return

  const { canvasPanX, canvasPanY, canvasScale, addImage } = state

  const shortLog =
    promptTrim.length > 40 ? `${promptTrim.slice(0, 40)}…` : promptTrim
  console.log(`[image/gen] start prompt=${shortLog} api=${api} model=${model} count=${count}`)

  const baseSize = pixelSizeFromRatioAndResolution(ratio, resolution)
  const imageCountAtStart = canvas.images.length

  // Midjourney 一次生成回 4 张独立变体图（实测非四宫格）；数量/分辨率/参考图参数不适用
  const isMJ = api === 'apimart' && coerceApimartModelId(model) === 'midjourney'
  const effCount = isMJ ? 4 : count

  // MJ 的 4 张变体按 2×2 田字格平铺（30px 瀑布错位对大图等于全叠在一起）；其余模型保持原瀑布
  const MJ_GAP = 24
  let mjOrigin = { x: 40, y: 40 }
  if (isMJ && viewportEl) {
    mjOrigin = centerWorldPositionInViewport(
      viewportEl,
      baseSize.w * 2 + MJ_GAP,
      baseSize.h * 2 + MJ_GAP,
      canvasPanX,
      canvasPanY,
      canvasScale,
    )
  }

  const placeholderIds: string[] = []
  for (let i = 0; i < effCount; i++) {
    const imgId = nanoid()
    placeholderIds.push(imgId)
    let position: { x: number; y: number }
    if (isMJ) {
      position = {
        x: mjOrigin.x + (i % 2) * (baseSize.w + MJ_GAP),
        y: mjOrigin.y + Math.floor(i / 2) * (baseSize.h + MJ_GAP),
      }
    } else {
      const stagger = (imageCountAtStart + i) * CASCADE_STEP
      position = { x: 40 + stagger, y: 40 + stagger }
      if (viewportEl) {
        const center = centerWorldPositionInViewport(
          viewportEl,
          baseSize.w,
          baseSize.h,
          canvasPanX,
          canvasPanY,
          canvasScale,
        )
        position = { x: center.x + stagger, y: center.y + stagger }
      }
    }

    const placeholder: Image = {
      id: imgId,
      src: 'pending',
      position,
      size: baseSize,
      source: 'generated',
      metadata: {
        prompt: promptTrim,
        api: api === 'apimart' ? 'apimart' : 'google',
        model: api === 'apimart' ? coerceApimartModelId(model) : model,
        ratio,
        resolution,
        referenceImageIds: referenceImageIds.length ? [...referenceImageIds] : undefined,
        parents: [...referenceImageIds],
        generatedAt: Date.now(),
      },
      isLoading: true,
      cancelable: true,
    }
    addImage(placeholder)
    genAbort.set(imgId, new AbortController())
  }

  let refBlobs: { blob: Blob; mimeType: string }[] | undefined
  if (referenceImageIds.length > 0 && !isMJ) {
    try {
      refBlobs = await collectReferenceBlobs(referenceImageIds)
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e)
      console.error('[image/gen] ref error →', details)
      for (const imgId of placeholderIds) {
        genAbort.delete(imgId)
        useProjectStore.getState().patchImage(imgId, {
          isLoading: false,
          cancelable: false,
          uploadError: details,
        })
      }
      return
    }
  }

  type Outcome =
    | { kind: 'blob'; imgId: string; blob: Blob }
    | { kind: 'abort'; imgId: string }
    | { kind: 'fail'; imgId: string }

  let outcomes: Outcome[]

  if (isMJ) {
    try {
      const { blobs, taskId } = await generateMidjourneyViaAPImart({
        prompt: promptTrim,
        size: ratio,
      })
      if (blobs.length === 0 || !blobs.some((b) => b && b.size > 0)) {
        throw new Error('[mj] empty result')
      }
      outcomes = placeholderIds.map((imgId, idx) => {
        const blob = blobs[idx]
        if (!blob || blob.size === 0) {
          // 返回数少于 4（如网格模式只回 1 张）：多余占位直接移除，不算失败
          genAbort.delete(imgId)
          useProjectStore.getState().removeImage(imgId)
          return { kind: 'abort' as const, imgId }
        }
        // taskId + 变体序号落元数据，工具栏"放大"按钮据此调 upscale
        const st = useProjectStore.getState()
        const prevMeta = st.currentProjectCanvas?.images.find((im) => im.id === imgId)?.metadata
        if (prevMeta) {
          st.patchImage(imgId, { metadata: { ...prevMeta, mjTaskId: taskId, mjIndex: idx + 1 } })
        }
        return { kind: 'blob' as const, imgId, blob }
      })
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e)
      console.error('[mj] error →', details)
      outcomes = placeholderIds.map((imgId) => {
        genAbort.delete(imgId)
        useProjectStore.getState().patchImage(imgId, {
          isLoading: false,
          cancelable: false,
          uploadError: details,
        })
        return { kind: 'fail' as const, imgId }
      })
    }
  } else if (api === 'apimart') {
    const imageBlobs = refBlobs?.map((r) => r.blob)
    try {
      const blobs = await generateViaAPImart({
        model: coerceApimartModelId(model),
        prompt: promptTrim,
        size: ratio,
        resolution,
        n: count,
        imageBlobs,
      })
      outcomes = placeholderIds.map((imgId, idx) => {
        const blob = blobs[idx]
        if (blob && blob.size > 0) {
          console.log('[gen/blob]', { idx, blobSize: blob.size, blobType: blob.type })
          return { kind: 'blob' as const, imgId, blob }
        }
        const details = blob ? 'empty blob' : 'missing image in batch'
        console.error('[image/gen] error →', details)
        genAbort.delete(imgId)
        useProjectStore.getState().patchImage(imgId, {
          isLoading: false,
          cancelable: false,
          uploadError: details,
        })
        return { kind: 'fail' as const, imgId }
      })
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e)
      console.error('[image/gen] error →', details)
      outcomes = placeholderIds.map((imgId) => {
        genAbort.delete(imgId)
        useProjectStore.getState().patchImage(imgId, {
          isLoading: false,
          cancelable: false,
          uploadError: details,
        })
        return { kind: 'fail' as const, imgId }
      })
    }
  } else {
    outcomes = await Promise.all(
      placeholderIds.map(async (imgId, idx) => {
        const ctrl = genAbort.get(imgId)
        try {
          const blob = await generateOneImage(
            { prompt: promptTrim, model, ratio, resolution },
            { signal: ctrl?.signal, referenceBlobs: refBlobs },
          )
          console.log('[gen/blob]', { idx, blobSize: blob.size, blobType: blob.type })
          return { kind: 'blob' as const, imgId, blob }
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') {
            genAbort.delete(imgId)
            return { kind: 'abort' as const, imgId }
          }
          const details = e instanceof Error ? e.message : String(e)
          console.error('[image/gen] error →', details)
          genAbort.delete(imgId)
          useProjectStore.getState().patchImage(imgId, {
            isLoading: false,
            cancelable: false,
            uploadError: details,
          })
          return { kind: 'fail' as const, imgId }
        }
      }),
    )
  }

  const blobsReceived = outcomes.filter(
    (o): o is { kind: 'blob'; imgId: string; blob: Blob } => o.kind === 'blob',
  )

  const prepared: { imgId: string; blob: Blob; name: string }[] = []
  for (const { imgId, blob } of blobsReceived) {
    if (!useProjectStore.getState().currentProjectCanvas?.images.some((im) => im.id === imgId)) {
      genAbort.delete(imgId)
      continue
    }
    if (!blob || blob.size === 0) {
      genAbort.delete(imgId)
      useProjectStore.getState().patchImage(imgId, {
        isLoading: false,
        cancelable: false,
        uploadError: `empty blob: img-${imgId}`,
      })
      continue
    }
    prepared.push({
      imgId,
      blob,
      name: assetFilenameForGeneratedImage(imgId, blob),
    })
  }

  if (prepared.length > 0) {
    console.log(
      `[image/gen] all ${prepared.length} blobs received, preparing single commit`,
    )
  }

  const newAssets: { name: string; blob: Blob }[] = []
  for (const { imgId, blob, name } of prepared) {
    if (patchStoreAfterGeneratedBlob(imgId, blob, name)) {
      genAbort.delete(imgId)
      newAssets.push({ name, blob })
    }
  }

  const committedNames = new Set(newAssets.map((a) => a.name))
  for (const { imgId, name } of prepared) {
    if (!committedNames.has(name)) continue
    console.log('[gen/finalize]', imgId, 'isLoading=false', `src=assets/${name}`)
  }

  // 生成耗时几十秒，期间可能已切项目/回首页——绝不能把 null 或别的项目的画布写进原项目
  const stFinal = useProjectStore.getState()
  if (
    stFinal.currentProjectId !== projectId ||
    !stFinal.currentProjectMeta ||
    !stFinal.currentProjectCanvas
  ) {
    console.warn('[image/gen] project changed during generation, skip commit')
    return
  }
  if (newAssets.length === 0) {
    console.log('[image/gen] no successful assets, skip commit')
    return
  }
  await github.saveProject(
    projectId,
    stFinal.currentProjectMeta,
    stFinal.currentProjectCanvas,
    newAssets,
  )

  if (newAssets.length > 0) {
    console.log(
      `[image/gen] commit done with ${newAssets.length} assets, all image.src updated`,
    )
  }

  console.log('[image/gen] all done')
}
