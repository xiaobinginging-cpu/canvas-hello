export type APImartVideoModel =
  | 'grok-imagine-1.0-video-apimart'
  | 'happyhorse-1.0'
  | 'kling-v3'
  | 'doubao-seedance-2.0'

/** 百炼（DashScope）直连视频模型（用千问 key）。 */
export type DashscopeVideoModel = 'happyhorse-1.0-t2v'

/** 视频生成器支持的全部模型。 */
export type VideoModel = APImartVideoModel | DashscopeVideoModel

export type VideoProvider = 'apimart' | 'dashscope'

/** 模型 → provider 路由。 */
export function videoProviderForModel(model: VideoModel): VideoProvider {
  return model === 'happyhorse-1.0-t2v' ? 'dashscope' : 'apimart'
}

/** 视频生成分辨率档位（UI）；各模型在生成函数内映射为 API 字段。 */
export type VideoQuality = '480p' | '720p' | '1080p' | '4k'
