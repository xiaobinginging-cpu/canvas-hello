import OpenAI from 'openai'
import {
  API_KEY_LABEL,
  getApiKey,
  isUnauthorizedError,
  missingApiKeyMessage,
} from './apiKeys.ts'
import { getChatAgent } from './chatProviders.ts'
import type { ChatProvider } from '../types/chat.ts'

/** 走通用流式代理 `/api/llm/<agent>`（解决 CORS + 流式透传）。 */
function proxyBaseURL(agentId: ChatProvider): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost:5273'
  return `${origin}/api/llm/${agentId}`
}

/** OpenAI 兼容客户端：apiKey 走 BYOK、baseURL 指向本代理。 */
function createClient(agentId: ChatProvider, keyProvider: Parameters<typeof getApiKey>[0]): OpenAI {
  return new OpenAI({
    apiKey: getApiKey(keyProvider) ?? '',
    baseURL: proxyBaseURL(agentId),
    dangerouslyAllowBrowser: true,
  })
}

/** 多模态内容：纯文本，或 文本 + 图片 part 数组（OpenAI 兼容）。 */
export type ChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: ChatContent
}

/**
 * 流式聊天：增量 token 经 {@link onDelta} 回调实时吐出，返回完整文本。
 * @throws 缺 key / key 失效 / 网络错误。
 */
export async function streamChat(opts: {
  agentId: ChatProvider
  model: string
  messages: ChatTurn[]
  signal?: AbortSignal
  onDelta: (text: string) => void
}): Promise<string> {
  const agent = getChatAgent(opts.agentId)
  if (!agent) throw new Error(`未知智能体: ${opts.agentId}`)
  if (!getApiKey(agent.keyProvider)) throw new Error(missingApiKeyMessage(agent.keyProvider))

  const client = createClient(agent.id, agent.keyProvider)
  let full = ''
  try {
    const stream = await client.chat.completions.create(
      {
        model: opts.model,
        messages: opts.messages as OpenAI.Chat.ChatCompletionMessageParam[],
        stream: true,
      },
      { signal: opts.signal },
    )
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        full += delta
        opts.onDelta(delta)
      }
    }
  } catch (e) {
    // 透出上游原始报错，便于排查（之前笼统包成「key 失效」会掩盖真正原因）。
    const status =
      typeof e === 'object' && e !== null && 'status' in e
        ? (e as { status?: unknown }).status
        : undefined
    const detail = e instanceof Error ? e.message : String(e)
    const label = API_KEY_LABEL[agent.keyProvider]
    if (isUnauthorizedError(e)) {
      throw new Error(`${label} 鉴权失败 (${status})：${detail}（key 失效 / 或该模型无权限）`, {
        cause: e,
      })
    }
    throw new Error(`${label} (${opts.model})：${detail}`, { cause: e })
  }
  return full
}
