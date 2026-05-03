import type { Image } from './image'
import type { APImartVideoModel } from './video.ts'

/** 提示词生成器产出的文本卡来源（持久化）。 */
export interface TextCardPromptGenSource {
  kind: 'prompt-gen'
  sourceImageIds: string[]
  api: 'google' | 'kimi'
  model: string
  instruction?: string
  generatedAt: number
}

/** 工具栏「新建文本」创建的手工卡；旧数据无 `kind` 时在 hydrate 中补齐。 */
export interface TextCardManualSource {
  kind: 'manual'
}

export type TextCardSource = TextCardPromptGenSource | TextCardManualSource

export interface TextCard {
  id: string
  x: number
  y: number
  width: number
  height: number
  text: string
  /** 缺省视为手工卡（兼容旧数据）。 */
  source?: TextCardSource
  createdAt: number
}

/**
 * 单个项目的顶层描述（列表 / 侧栏 / 库展示用）。
 */
export interface ProjectMeta {
  /**
   * 项目唯一 id，建议使用 `nanoid()`。
   */
  id: string

  /**
   * 展示名；新建时默认 `'未命名'`。
   */
  name: string

  /**
   * 创建时间 Unix 时间戳（ms），`Date.now()`。
   */
  createdAt: number

  /**
   * 最后修改时间 Unix 时间戳（ms），任意画布或元数据变更时更新。
   */
  updatedAt: number

  /**
   * 是否在侧栏 / 资源库顶部「置顶」区块展示。
   */
  pinned: boolean

  /**
   * 置顶操作的时间戳（ms），用于多个置顶项之间的排序；未置顶或未设置时可省略。
   * 与 {@link pinned} 同时为真时建议写入。
   */
  pinnedAt?: number
}

/**
 * 画布上的生成视频（APIMart v0）。
 */
export interface VideoItem {
  id: string
  x: number
  y: number
  width: number
  height: number
  src: string
  /** 生成时请求的时长（秒）。 */
  duration?: number
  api: 'apimart'
  model: APImartVideoModel
  prompt?: string
  ratio?: string
  referenceImageIds?: string[]
  parentVideoId?: string
  generatedAt?: number
  /** Grok：`quality`；HappyHorse 侧固定 `1080P` 请求，此处可记 `1080p` 便于展示。 */
  videoQuality?: string
  isLoading?: boolean
  uploadError?: string
  cancelable?: boolean
}

/**
 * 持久化的画布数据。**已移除 v1 的 nodes + edges**，仅保留图片列表。
 */
export interface CanvasData {
  /**
   * 画布上所有图片实体（含上传、生成、参考图等）。
   */
  images: Image[]
  /**
   * 画布视频（生成）；旧项目无此字段时按 `[]` 处理。
   */
  videos?: VideoItem[]
  /**
   * 提示词生成器等产生的文本卡；旧项目无此字段时按 `[]` 处理。
   */
  textCards?: TextCard[]
}
