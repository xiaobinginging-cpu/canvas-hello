/**
 * Chat 浮动小精灵的会话数据。多设备同步：存全局 `_chat/chat.json`（复用 R2/GitHub 同步基建，
 * 同 `_library`）。v0 单条滚动会话；多会话留 v1。
 */

export type ChatRole = 'user' | 'assistant'

/** 聊天「智能体」provider（全部走 OpenAI 兼容接口；≠ 图像生成的 apimart）。 */
export type ChatProvider = 'google' | 'kimi' | 'mimo' | 'glm' | 'qwen' | 'deepseek' | 'volcengine'

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

/** 一条会话（多会话历史的基本单位）。 */
export interface ChatSession {
  id: string
  /** 标题；默认取首条用户消息（截断）。 */
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

/** 每个 project 的聊天数据（存 `_chat/{projectId}.json`，多设备同步）。 */
export interface ChatData {
  sessions: ChatSession[]
  /** 最后更新时间戳（ms）；多设备 last-write-wins 参考。 */
  updatedAt: number
}

export const EMPTY_CHAT: ChatData = { sessions: [], updatedAt: 0 }

function normalizeMessages(raw: unknown): ChatMessage[] {
  return Array.isArray(raw)
    ? raw.filter(
        (m): m is ChatMessage =>
          !!m && typeof (m as ChatMessage).content === 'string' && !!(m as ChatMessage).role,
      )
    : []
}

/** 容错归一化 + 迁移旧格式（单条 `{ messages }` → 包成一个 session）。 */
export function normalizeChatData(raw: unknown): ChatData {
  const o = (raw ?? {}) as { sessions?: unknown; messages?: unknown; updatedAt?: unknown }
  const updatedAt = typeof o.updatedAt === 'number' ? o.updatedAt : 0

  if (Array.isArray(o.sessions)) {
    const sessions: ChatSession[] = o.sessions
      .filter((s): s is ChatSession => !!s && typeof (s as ChatSession).id === 'string')
      .map((s) => ({
        id: s.id,
        title: typeof s.title === 'string' ? s.title : '',
        messages: normalizeMessages(s.messages),
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
      }))
    return { sessions, updatedAt }
  }

  // 旧格式迁移：{ messages } → 一个 session
  const legacy = normalizeMessages(o.messages)
  if (legacy.length) {
    return {
      sessions: [
        { id: 'migrated', title: '', messages: legacy, createdAt: updatedAt, updatedAt },
      ],
      updatedAt,
    }
  }
  return { sessions: [], updatedAt }
}
