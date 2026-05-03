export type APImartVideoModel =
  | 'grok-imagine-1.0-video-apimart'
  | 'happyhorse-1.0'
  | 'kling-v3'
  | 'doubao-seedance-2.0'

/** 视频生成分辨率档位（UI）；各模型在 {@link generateVideoViaAPImart} 内映射为 API 字段。 */
export type VideoQuality = '480p' | '720p' | '1080p' | '4k'
