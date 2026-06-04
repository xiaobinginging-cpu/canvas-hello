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

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
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
      { model: opts.model, messages: opts.messages, stream: true },
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
    // 401/403 不一定是 key 失效——也可能是该 model 无访问权限（如 Qwen Plus 可用但 Max 未开通）。
    if (isUnauthorizedError(e)) {
      throw new Error(
        `${API_KEY_LABEL[agent.keyProvider]}：鉴权失败（key 失效，或当前账号无「${opts.model}」该模型权限）`,
        { cause: e },
      )
    }
    throw e
  }
  return full
}
