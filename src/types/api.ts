/**
 * 支持的第三方图像 / 多模态 API 品牌（密钥与路由在 {@link APIConfig} 中配置）。
 */
export type APIProvider = 'google' | 'apimart'

/**
 * 单个 provider 的调用配置（通常来自用户设置或环境，不落库明文时需另行加密）。
 */
export interface APIConfig {
  /** 使用哪家 provider。 */
  provider: APIProvider

  /** 该 provider 的 API Key（或代理下发的 token，语义由接入层定义）。 */
  apiKey: string
}

/**
 * 发起一次「文生图 / 条件生图」时的完整参数快照，用于请求构建与写入 {@link import('./image').ImageMetadata}。
 */
export interface GenerationConfig {
  /** 正向提示词。 */
  prompt: string

  /** 使用的 API 品牌，与 {@link APIProvider} 一致。 */
  api: APIProvider

  /** 模型标识（与 provider 控制台一致）。 */
  model: string

  /** 画幅比例；可选，默认策略由前端或 API 决定。 */
  ratio?: string

  /** 分辨率档位；可选。 */
  resolution?: string

  /**
   * 单次请求生成的张数（batch）。
   * 仅允许单批 1、2 或 4 张。
   */
  count: 1 | 2 | 4

  /**
   * 参考图 id 列表（对应画布上 {@link import('./image').Image} 的 `id`），来源可为框选画布或本地上传后入库的图。
   */
  referenceImageIds?: string[]
}

/**
 * 单次生成任务在 UI / 队列中的一条结果占位，用于列表与画布占位节点更新。
 */
export interface GenerationResult {
  /** 预分配或生成完成后的图片实体 id，与画布 {@link import('./image').Image} 对齐。 */
  imageId: string

  /**
   * 任务状态：`loading` 表示进行中；`success` / `failed` 表示结束态。
   */
  status: 'loading' | 'success' | 'failed'

  /** 失败时的错误信息（用户可读或用于 toast）；成功时可省略。 */
  error?: string
}
