import type { ApiKeyProvider } from './apiKeys.ts'
import type { ChatProvider } from '../types/chat.ts'

/**
 * Chat「智能体」注册表。全部走 **OpenAI 兼容** chat/completions（统一一条流式代码路径），
 * 经 `/api/llm/<id>` 通用流式代理转发到各家上游（解决浏览器 CORS + 流式）。
 * 上游 baseURL 映射在 `api/llm/[...path].ts`。新增一家 = 这里加一项 + 代理里加一行 + 设置页 key。
 *
 * 模型默认取「最新」；若斌可校正。MiMo 待补端点（见 api/llm 代理 TODO）。
 */
export interface ChatAgent {
  id: ChatProvider
  label: string
  keyProvider: ApiKeyProvider
  models: { value: string; label: string }[]
}

export const CHAT_AGENTS: readonly ChatAgent[] = [
  {
    id: 'google',
    label: 'Gemini',
    keyProvider: 'google',
    models: [
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    keyProvider: 'deepseek',
    models: [
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    ],
  },
  {
    id: 'kimi',
    label: 'Kimi',
    keyProvider: 'kimi',
    models: [{ value: 'kimi-k2.6', label: 'Kimi k2.6' }],
  },
  {
    id: 'glm',
    label: 'GLM',
    keyProvider: 'glm',
    models: [
      { value: 'GLM-5.1', label: 'GLM-5.1' },
      { value: 'GLM-5V-Turbo', label: 'GLM-5V Turbo' },
    ],
  },
  {
    id: 'qwen',
    label: 'Qwen',
    keyProvider: 'qwen',
    models: [
      // DashScope API id 小写；旗舰 Qwen3.7-Max → qwen3.7-max（qwen-max-latest 是老别名、key 未授权 → 403）
      { value: 'qwen3.7-max', label: 'Qwen3.7 Max' },
      { value: 'qwen-plus-latest', label: 'Qwen Plus' },
    ],
  },
  {
    id: 'mimo',
    label: 'MiMo',
    keyProvider: 'mimo',
    models: [{ value: 'mimo-v2.5-pro', label: 'MiMo v2.5 Pro' }],
  },
] as const

export const DEFAULT_CHAT_AGENT_ID: ChatProvider = 'google'

export function getChatAgent(id: ChatProvider): ChatAgent | undefined {
  return CHAT_AGENTS.find((a) => a.id === id)
}
