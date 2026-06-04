/**
 * 素材库（Asset Library）应用层：画布 ↔ 全局 `_library/`。
 * 存储原语在 {@link import('./github')}（loadLibrary / saveLibrary / fetchLibraryAsset…），复用 R2+GitHub 基建。
 *
 * 两个核心动作：
 * - {@link saveImageToLibrary}：画布选中图 →「存入素材库」（拷贝 blob 到 `_library/assets/`）。
 * - {@link addLibraryMaterialToCanvasAsReference}：素材库 →「用到画布」。**把 blob 拷进当前 project 的 `assets/`**、
 *   新建一个 `source:'reference'` 的画布 Image。这样既满足「同一参考图拉进不同 project」，又让既有 fetchAsset /
 *   生成参考 / 视频参考全链路无需改动（都假设 project 相对 `assets/…` 路径）。
 */
import { nanoid } from 'nanoid'
import {
  CANVAS_PLACE_MAX_PX,
  capDisplaySize,
  centerWorldPositionInViewport,
  readImageFileDimensions,
} from './canvasGeometry.ts'
import { parseFilenameFromSrc } from './canvasUpload.ts'
import * as github from './github.ts'
import { useProjectStore } from '../store/useStore.ts'
import type { Image as CanvasImage } from '../types/image.ts'
import type { LibraryMaterial, MaterialKind } from '../types/library.ts'

const CASCADE_STEP_PX = 30

/** Image extension from blob MIME, falling back to a path's extension, then `png`. */
function imageExt(blobType: string | undefined, fallbackPath: string): string {
  const t = (blobType ?? '').toLowerCase()
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  if (t.includes('png')) return 'png'
  if (t.includes('webp')) return 'webp'
  if (t.includes('gif')) return 'gif'
  const raw = (fallbackPath.split('.').pop() || '').toLowerCase()
  if (raw === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'webp', 'gif'].includes(raw)) return raw
  return 'png'
}

/** Last path segment (filename) of a `_library/assets/…` or `assets/…` src. */
function filenameFromSrc(src: string): string {
  return src.split('/').filter(Boolean).pop() ?? ''
}

/** Resolve a canvas image's bytes: object-URL cache first, else fetch its project asset. */
async function blobForCanvasImage(image: CanvasImage): Promise<Blob> {
  const state = useProjectStore.getState()
  const cached = state.imageObjectUrls.get(image.id)
  if (cached) {
    const res = await fetch(cached)
    return await res.blob()
  }
  const projectId = state.currentProjectId
  const fn = parseFilenameFromSrc(image.src)
  if (!projectId || !fn || image.src === 'pending' || image.isLoading) {
    throw new Error('图片尚未保存到仓库，请等待保存完成后再存入素材库')
  }
  return await github.fetchAsset(projectId, fn)
}

/**
 * 「存入素材库」：把画布选中图拷进 `_library/assets/`，并在 `library.json` 追加一条 {@link LibraryMaterial}。
 * @returns 新建的素材条目。
 */
export async function saveImageToLibrary(
  image: CanvasImage,
  opts: { kind: MaterialKind; name?: string; tags?: string[] },
): Promise<LibraryMaterial> {
  const blob = await blobForCanvasImage(image)
  if (!blob || blob.size === 0) throw new Error('图片内容为空，无法存入素材库')

  const materialId = `lib-${nanoid()}`
  const ext = imageExt(blob.type, image.src)
  const assetFilename = `${materialId}.${ext}`

  const material: LibraryMaterial = {
    id: materialId,
    src: `_library/assets/${assetFilename}`,
    kind: opts.kind,
    name: opts.name?.trim() || image.metadata.originalFilename || undefined,
    tags: opts.tags && opts.tags.length ? opts.tags : undefined,
    thumb: { w: image.size.w, h: image.size.h },
    addedAt: Date.now(),
    sourceImageId: image.id,
  }

  const data = await github.loadLibrary()
  data.materials = [material, ...data.materials]
  await github.saveLibrary(data, [{ name: assetFilename, blob }])

  return material
}

/**
 * 「用到画布」：把一条素材库素材拷进**当前 project** 的 `assets/`，新建 `source:'reference'` 画布图。
 * @returns 新建画布图 id（失败抛错）。
 */
export async function addLibraryMaterialToCanvasAsReference(
  material: LibraryMaterial,
  canvasEl: HTMLElement | null,
): Promise<string> {
  const state = useProjectStore.getState()
  const projectId = state.currentProjectId
  const meta = state.currentProjectMeta
  const canvas = state.currentProjectCanvas
  if (!projectId || !meta || !canvas) throw new Error('未打开项目，无法添加参考图')

  // 尺寸/扩展名/落点全部由 material 元数据推导，不依赖 blob——先乐观落图，再后台下载+拷贝。
  const libFilename = filenameFromSrc(material.src)
  const imgId = nanoid()
  const ext = imageExt(undefined, material.src)
  const projAssetName = `img-${imgId}.${ext}`
  const src = `assets/${projAssetName}`

  const dims = material.thumb ?? { w: 300, h: 300 }
  const size = capDisplaySize(dims.w, dims.h, CANVAS_PLACE_MAX_PX)

  const { canvasPanX, canvasPanY, canvasScale } = state
  const stagger = canvas.images.length * CASCADE_STEP_PX
  let position = { x: 40 + stagger, y: 40 + stagger }
  if (canvasEl) {
    const base = centerWorldPositionInViewport(
      canvasEl,
      size.w,
      size.h,
      canvasPanX,
      canvasPanY,
      canvasScale,
    )
    position = { x: base.x + stagger, y: base.y + stagger }
  }

  const newImage: CanvasImage = {
    id: imgId,
    src,
    position,
    size,
    source: 'reference',
    metadata: {
      uploadedAt: Date.now(),
      originalFilename: material.name,
      libraryMaterialId: material.id,
    },
    isLoading: true,
  }

  // 乐观：立即上画布（loading 占位），调用方拿到 id 即可关弹窗 / 写进参考表单。
  useProjectStore.getState().addImage(newImage)

  // 后台：下载素材 blob → 拷进当前 project assets → 落盘。失败时在该图上标错（与拖拽上传一致）。
  void (async () => {
    try {
      const blob = await github.fetchLibraryAsset(libFilename)
      if (!blob || blob.size === 0) throw new Error('素材内容为空')
      await github.saveProject(
        projectId,
        useProjectStore.getState().currentProjectMeta!,
        useProjectStore.getState().currentProjectCanvas!,
        [{ name: projAssetName, blob }],
      )
      const blobUrl = URL.createObjectURL(blob)
      useProjectStore.getState().registerImageObjectUrl(imgId, blobUrl)
      useProjectStore.getState().patchImage(imgId, { isLoading: false, uploadError: undefined })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '添加失败'
      useProjectStore.getState().patchImage(imgId, { isLoading: false, uploadError: msg })
    }
  })()

  return imgId
}

/**
 * 直接把本地文件上传进素材库（不经画布）。单次读取索引 + 批量追加 + 一次写回。
 * @returns 新建的素材条目（已倒序在前）。
 */
export async function uploadFilesToLibrary(
  files: File[],
  kind: MaterialKind = 'reference',
): Promise<LibraryMaterial[]> {
  const imageFiles = files.filter((f) => f.type.startsWith('image/'))
  if (imageFiles.length === 0) return []

  const data = await github.loadLibrary()
  const added: LibraryMaterial[] = []
  const assets: { name: string; blob: Blob }[] = []

  for (const file of imageFiles) {
    const materialId = `lib-${nanoid()}`
    const ext = imageExt(file.type, file.name)
    const assetFilename = `${materialId}.${ext}`
    let dims = { w: 300, h: 300 }
    try {
      dims = await readImageFileDimensions(file)
    } catch {
      /* keep default */
    }
    added.push({
      id: materialId,
      src: `_library/assets/${assetFilename}`,
      kind,
      name: file.name,
      thumb: dims,
      addedAt: Date.now(),
    })
    assets.push({ name: assetFilename, blob: file })
  }

  data.materials = [...added, ...data.materials]
  await github.saveLibrary(data, assets)
  return added
}

/**
 * 把一条素材加入**指定 project**（库页用——当前不一定开着项目）。
 * 直接 load 该 project → 拷贝 blob 进其 assets → 追加 `source:'reference'` 画布图 → 落盘。
 * 若该 project 恰好是当前打开的，同步更新内存 store。
 */
export async function addLibraryMaterialToProject(
  material: LibraryMaterial,
  projectId: string,
): Promise<void> {
  const { meta, canvas } = await github.loadProject(projectId)

  const blob = await github.fetchLibraryAsset(filenameFromSrc(material.src))
  if (!blob || blob.size === 0) throw new Error('素材内容为空')

  const imgId = nanoid()
  const ext = imageExt(blob.type, material.src)
  const projAssetName = `img-${imgId}.${ext}`
  const dims = material.thumb ?? { w: 300, h: 300 }
  const size = capDisplaySize(dims.w, dims.h, CANVAS_PLACE_MAX_PX)
  const n = canvas.images.length
  const position = { x: 40 + n * CASCADE_STEP_PX, y: 40 + n * CASCADE_STEP_PX }

  const newImage: CanvasImage = {
    id: imgId,
    src: `assets/${projAssetName}`,
    position,
    size,
    source: 'reference',
    metadata: {
      uploadedAt: Date.now(),
      originalFilename: material.name,
      libraryMaterialId: material.id,
    },
  }

  const nextCanvas = { ...canvas, images: [...canvas.images, newImage] }
  const nextMeta = { ...meta, updatedAt: Date.now() }
  await github.saveProject(projectId, nextMeta, nextCanvas, [{ name: projAssetName, blob }])

  // 该项目正开着 → 同步内存，避免回到画布看不到（不重复落盘）。
  const st = useProjectStore.getState()
  if (st.currentProjectId === projectId && st.currentProjectCanvas) {
    const blobUrl = URL.createObjectURL(blob)
    st.registerImageObjectUrl(imgId, blobUrl)
    useProjectStore.setState({
      currentProjectCanvas: {
        ...st.currentProjectCanvas,
        images: [...st.currentProjectCanvas.images, newImage],
      },
    })
  }
}

/** 删除一条素材：从 `library.json` 移除 + best-effort 删资产对象。 */
export async function deleteLibraryMaterial(materialId: string): Promise<void> {
  const data = await github.loadLibrary()
  const target = data.materials.find((m) => m.id === materialId)
  if (!target) return
  data.materials = data.materials.filter((m) => m.id !== materialId)
  await github.saveLibrary(data, [])
  try {
    await github.deleteLibraryAssetObject(filenameFromSrc(target.src))
  } catch (e) {
    console.warn('[library] asset object delete failed (index already updated)', e)
  }
}
