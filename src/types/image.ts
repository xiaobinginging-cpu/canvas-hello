/**
 * 图片来源：上传本地、模型生成、或仅作参考（不导出 / 辅助构图）。
 * - `upload`：`metadata.uploadedAt`、`originalFilename` 等有语义。
 * - `generated`：`metadata.prompt`、`api`、`model` 等生成链路字段必带（见各字段 JSDoc）。
 * - `reference`：通常只有展示与参考关系，不一定有生成元数据。
 */
export type ImageSource = 'upload' | 'generated' | 'reference'

import type { APIProvider } from './api'

/**
 * 与单张画布图片绑定的元数据。字段是否「必带」由 {@link ImageSource} 决定：
 * - **generated**：见各字段「generated 必带」说明。
 * - **upload**：见「upload」说明。
 * - **reference**：多数可选，用于 lineage / 人工标注。
 */
export interface ImageMetadata {
  /**
   * 生成该图时使用的完整 prompt 文案。
   * **generated 必带**；upload / reference 通常省略。
   */
  prompt?: string

  /**
   * 使用的 API 提供商（如 `'google'`、`'apimart'`）。
   * **generated 必带**（与具体接入约定一致时）。
   */
  api?: APIProvider

  /**
   * 具体模型名（如 Gemini 形象模型 ID）。
   * **generated 必带**。
   */
  model?: string

  /**
   * 画幅比例，如 `'16:9'`、`'1:1'`。
   * **generated** 常用；upload / reference 可省略。
   */
  ratio?: string

  /**
   * 分辨率档位，如 `'4K'`、`'2K'`、`'1K'`。
   * **generated** 常用；其余来源可省略。
   */
  resolution?: string

  /**
   * 本次生成使用的参考图 id 列表（画布上已存在的 {@link Image} id）。
   * **generated** 在「带参考图生图」时必带引用关系；无参考时可省略空数组。
   */
  referenceImageIds?: string[]

  /**
   * 「画同款」时的父图 id，用于血缘 / 版本追踪。
   * **generated** 在衍生同款时建议带上；upload 可为导入原图的父节点（若产品需要）。
   */
  parentImageId?: string

  /**
   * 生成完成时的 Unix 时间戳（ms）。
   * **generated** 在成功落盘后应有；loading 阶段可无。
   */
  generatedAt?: number

  /**
   * 用户上传完成时的 Unix 时间戳（ms）。
   * **upload 必带**（或业务上首次写入本地可视为上传时间）。
   */
  uploadedAt?: number

  /**
   * 用户选择的原始文件名（用于展示与导出命名）。
   * **upload** 建议带；generated 通常省略。
   */
  originalFilename?: string
}

/**
 * 画布上的一张图片实体（自由布局 + 元数据）。对应 v1 的节点模型；**不再包含 edges**。
 */
export interface Image {
  /** 唯一 id，建议使用 `nanoid()` 生成。 */
  id: string

  /**
   * 资源路径，相对于 project 目录，如 `'assets/img-{nanoid}.png'`。
   * 占位或外链场景也可存 data URL / http（由存储层约定）。
   */
  src: string

  /** 在画布坐标系中的左上角位置（px 或与 zoom 无关的逻辑坐标，由渲染层约定）。 */
  position: { x: number; y: number }

  /**
   * 画布上显示的宽高（px）。v1.5 可由用户拖拽 resize 修改。
   */
  size: { w: number; h: number }

  /** 来源类型，决定 {@link metadata} 中哪些字段生效或必带。 */
  source: ImageSource

  /** 与来源相关的业务元数据。 */
  metadata: ImageMetadata

  /**
   * 生成或加载过程中为 `true`，用于骨架屏 / 进度占位。
   * 任意 `source` 在异步阶段均可使用。
   */
  isLoading?: boolean

  /** 上传失败时的错误文案；成功或重试前应清除。 */
  uploadError?: string

  /**
   * 是否在 UI 上允许取消当前进行中的生成任务。
   * 通常仅 `source === 'generated'` 且 `isLoading === true` 时有意义。
   */
  cancelable?: boolean
}
