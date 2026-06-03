/**
 * 素材库（Asset Library）· 跨 project 全局存储层（`_library/`）。
 *
 * v0 MVP 仅实现 {@link LibraryMaterial}（图片素材：跨 project 参考图 + 原始上传，用 {@link MaterialKind} 区分）。
 * {@link StylePreset}（v1）与 {@link PromptTemplate}（v2）先占位、保持 `library.json` schema 完整、后续不破坏结构。
 *
 * 存储位置见 `canvas-spec.md` §1「素材库」：
 * `canvas-tool-projects/_library/library.json` + `_library/assets/lib-{nanoid}.png`。
 */

/**
 * 图片素材种类。合并 spec 的「类型 1 跨 project 参考图」与「类型 4 原始上传素材」一类，用 kind 区分。
 * - `reference`：可反复调用的参考图。
 * - `raw`：原始底图 / 草图 / 平面图等上传素材。
 */
export type MaterialKind = 'reference' | 'raw'

/**
 * 一条图片素材（跨 project 全局，比画布 {@link import('./image').Image} 轻——无 position/size）。
 * 「用到画布」时 = 在某 project 内新建一个 `source:'reference'` 的 Image，并把 blob 拷进该 project 的 `assets/`。
 */
export interface LibraryMaterial {
  /** `lib-{nanoid}`。 */
  id: string
  /** `_library/assets/lib-{nanoid}.{ext}`（相对 repo 根）。 */
  src: string
  /** 区分参考图 / 原始素材。 */
  kind: MaterialKind
  /** 用户起名 / 原始文件名。 */
  name?: string
  /** 分类检索标签。 */
  tags?: string[]
  /** 原图像素尺寸，用于浏览缩略图比例。 */
  thumb?: { w: number; h: number }
  /** 存入时间戳（ms）。 */
  addedAt: number
  /** 若从某 project 画布「存入素材库」，记来源画布图 id（lineage）。 */
  sourceImageId?: string
}

/**
 * 类型 2：风格 / 材质预设（USP-3）。**v1 实现**，v0 仅占位以保持 `library.json` schema 稳定。
 */
export interface StylePreset {
  id: string
  name: string
  /** 关联素材库里的风格图（{@link LibraryMaterial.id}）。 */
  referenceMaterialIds?: string[]
  /** 风格描述片段，生成时拼进 prompt。 */
  promptFragment?: string
  /** 可选默认生成参数。 */
  defaults?: { api?: string; model?: string; ratio?: string }
  addedAt: number
}

/**
 * 类型 3：私人 prompt 模板（≠ marketplace / 不分享）。**v2 实现**，v0 仅占位。
 */
export interface PromptTemplate {
  id: string
  name: string
  /** 含 `{{占位符}}` 的 prompt 文案。 */
  template: string
  tags?: string[]
  addedAt: number
}

/**
 * `_library/library.json` 顶层结构。三类内容的索引（v0 仅写 `materials`）。
 */
export interface LibraryData {
  materials: LibraryMaterial[]
  presets: StylePreset[]
  promptTemplates: PromptTemplate[]
}

export const EMPTY_LIBRARY: LibraryData = {
  materials: [],
  presets: [],
  promptTemplates: [],
}

/** 容错归一化（旧 / 部分 `library.json` 可能缺字段）。 */
export function normalizeLibraryData(raw: unknown): LibraryData {
  const o = (raw ?? {}) as Partial<LibraryData>
  return {
    materials: Array.isArray(o.materials) ? o.materials : [],
    presets: Array.isArray(o.presets) ? o.presets : [],
    promptTemplates: Array.isArray(o.promptTemplates) ? o.promptTemplates : [],
  }
}
