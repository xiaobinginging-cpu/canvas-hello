export type ApiKeyProvider =
  | 'google'
  | 'kimi'
  | 'apimart'
  | 'mimo'
  | 'glm'
  | 'qwen'
  | 'deepseek'

const STORAGE: Record<ApiKeyProvider, string> = {
  google: 'canvas-hello.api-key.google',
  kimi: 'canvas-hello.api-key.kimi',
  apimart: 'canvas-hello.api-key.apimart',
  mimo: 'canvas-hello.api-key.mimo',
  glm: 'canvas-hello.api-key.glm',
  qwen: 'canvas-hello.api-key.qwen',
  deepseek: 'canvas-hello.api-key.deepseek',
}

export const API_KEYS_CHANGED_EVENT = 'canvas-hello-api-keys-changed'

export const API_KEY_LABEL: Record<ApiKeyProvider, string> = {
  google: 'Google AI',
  kimi: 'Kimi',
  apimart: 'APIMart',
  mimo: 'MiMo',
  glm: 'GLM (智谱)',
  qwen: 'Qwen (通义)',
  deepseek: 'DeepSeek',
}

export function getApiKey(provider: ApiKeyProvider): string | null {
  try {
    const v = localStorage.getItem(STORAGE[provider])
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  } catch {
    /* ignore */
  }
  return null
}

export function setApiKey(provider: ApiKeyProvider, value: string): void {
  try {
    const t = value.trim()
    if (!t) localStorage.removeItem(STORAGE[provider])
    else localStorage.setItem(STORAGE[provider], t)
    window.dispatchEvent(new Event(API_KEYS_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

export function hasApiKey(provider: ApiKeyProvider): boolean {
  return getApiKey(provider) != null
}

export function allThreeApiKeysEmpty(): boolean {
  return !hasApiKey('google') && !hasApiKey('kimi') && !hasApiKey('apimart')
}

export function missingApiKeyMessage(provider: ApiKeyProvider): string {
  return `${API_KEY_LABEL[provider]} API key 未配置，去设置 →`
}

export function invalidApiKeyMessage(provider: ApiKeyProvider): string {
  return `${API_KEY_LABEL[provider]} API key 失效，请检查`
}

export function isUnauthorizedError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const o = e as Record<string, unknown>
  const st = o.status
  if (st === 401 || st === 403) return true
  const resp = o.response as { status?: number } | undefined
  if (resp?.status === 401 || resp?.status === 403) return true
  if (o.code === 'invalid_api_key') return true
  return false
}
