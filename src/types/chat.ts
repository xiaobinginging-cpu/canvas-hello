/**
 * Chat 浮动小精灵的会话数据。多设备同步：存全局 `_chat/chat.json`（复用 R2/GitHub 同步基建，
 * 同 `_library`）。v0 单条滚动会话；多会话留 v1。
 */

export type ChatRole = 'user' | 'assistant'

/** 聊天「智能体」provider（全部走 OpenAI 兼容接口；≠ 图像生成的 apimart）。 */
export type ChatProvider = 'google' | 'kimi' | 'mimo' | 'glm' | 'qwen' | 'deepseek'

/** user 消息附带的图片（多模态）。存 `_chat/assets/`、跨设备同步。 */
export interface ChatImageRef {
  /** `_chat/assets/chat-{nanoid}.{ext}`。 */
  src: string
  /** 原始文件名（可选）。 */
  name?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** user 消息附带的图（多模态）；无图省略。 */
  images?: ChatImageRef[]
  /** assistant 消息：生成所用 provider/model（user 消息可省略）。 */
  api?: ChatProvider
  model?: string
  createdAt: number
}

export interface ChatData {
  messages: ChatMessage[]
  /** 最后更新时间戳（ms）；多设备 last-write-wins 参考。 */
  updatedAt: number
}

export const EMPTY_CHAT: ChatData = { messages: [], updatedAt: 0 }

/** 容错归一化（旧 / 部分 chat.json）。 */
export function normalizeChatData(raw: unknown): ChatData {
  const o = (raw ?? {}) as Partial<ChatData>
  const messages = Array.isArray(o.messages)
    ? o.messages.filter(
        (m): m is ChatMessage =>
          !!m && typeof (m as ChatMessage).content === 'string' && !!(m as ChatMessage).role,
      )
    : []
  return {
    messages,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
  }
}
