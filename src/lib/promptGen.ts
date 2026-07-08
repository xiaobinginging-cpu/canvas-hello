import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  getApiKey,
  hasApiKey,
  invalidApiKeyMessage,
  isUnauthorizedError,
  missingApiKeyMessage,
} from './apiKeys.ts'

function kimiBaseURL(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/kimi/v1`
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:5273/api/kimi/v1'
  }
  return 'https://api.moonshot.cn/v1'
}

function createKimiClient(): OpenAI {
  return new OpenAI({
    apiKey: getApiKey('kimi') ?? '',
    baseURL: kimiBaseURL(),
    dangerouslyAllowBrowser: true,
  })
}

function createGooglePromptClient(): GoogleGenerativeAI {
  return new GoogleGenerativeAI(getApiKey('google') ?? '')
}

/** 火山方舟（豆包）走通用 /api/llm 流式代理，同 chat 小精灵一条链路。 */
function volcBaseURL(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/llm/volcengine`
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:5273/api/llm/volcengine'
  }
  return 'https://ark.cn-beijing.volces.com/api/v3'
}

function createVolcClient(): OpenAI {
  return new OpenAI({
    apiKey: getApiKey('volcengine') ?? '',
    baseURL: volcBaseURL(),
    dangerouslyAllowBrowser: true,
  })
}

export type PromptGenAPI = 'google' | 'kimi' | 'volcengine'

export type GooglePromptVisionModel =
  | 'gemini-3.1-flash-lite-preview'
  | 'gemini-3-flash-preview'
  | 'gemini-3.1-pro-preview'

export type VolcPromptModel = 'doubao-seed-2-1-turbo-260628' | 'doubao-seed-2-1-pro-260628'

export type PromptGenModel = GooglePromptVisionModel | 'kimi-k2.6' | VolcPromptModel

export const GOOGLE_PROMPT_MODEL_OPTIONS: ReadonlyArray<{
  value: GooglePromptVisionModel
  label: string
}> = [
  { value: 'gemini-3.1-flash-lite-preview', label: '3.1 Flash Lite' },
  { value: 'gemini-3-flash-preview', label: '3 Flash' },
  { value: 'gemini-3.1-pro-preview', label: '3.1 Pro' },
]

export const GOOGLE_PROMPT_MODEL_VALUES: readonly GooglePromptVisionModel[] =
  GOOGLE_PROMPT_MODEL_OPTIONS.map((o) => o.value)

export const KIMI_PROMPT_MODELS: readonly PromptGenModel[] = ['kimi-k2.6']

/** Seed 2.1（2026-06）：Turbo 半价低延迟默认在前，两个都是多模态（吃图）。 */
export const VOLC_PROMPT_MODEL_OPTIONS: ReadonlyArray<{
  value: VolcPromptModel
  label: string
}> = [
  { value: 'doubao-seed-2-1-turbo-260628', label: 'Seed 2.1 Turbo' },
  { value: 'doubao-seed-2-1-pro-260628', label: 'Seed 2.1 Pro' },
]

/** OpenAI 兼容分支（kimi / volcengine）共用的 client 与 key provider。 */
function openAICompatFor(api: 'kimi' | 'volcengine'): {
  keyProvider: 'kimi' | 'volcengine'
  createClient: () => OpenAI
} {
  return api === 'volcengine'
    ? { keyProvider: 'volcengine', createClient: createVolcClient }
    : { keyProvider: 'kimi', createClient: createKimiClient }
}

export const DEFAULT_PROMPT_GEN_INSTRUCTION_PLACEHOLDER =
  '用一段中文详细描述这张图、要适合作为图像生成 AI 的 prompt'

function defaultInstructionForImageCount(n: number): string {
  if (n <= 1) return DEFAULT_PROMPT_GEN_INSTRUCTION_PLACEHOLDER
  return '用一段中文综合描述这些图片、要适合作为图像生成 AI 的 prompt'
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function hasKimiApiKey(): boolean {
  return hasApiKey('kimi')
}

async function generatePromptTextOnly(opts: {
  api: PromptGenAPI
  model: PromptGenModel
  instruction: string
}): Promise<string> {
  const { api, model, instruction } = opts

  if (api === 'google') {
    if (!getApiKey('google')) throw new Error(missingApiKeyMessage('google'))
    try {
      const genModel = createGooglePromptClient().getGenerativeModel({ model })
      const result = await genModel.generateContent(instruction)
      const text = result.response.text().trim()
      if (!text) throw new Error('Google returned empty text')
      return text
    } catch (e) {
      if (isUnauthorizedError(e)) throw new Error(invalidApiKeyMessage('google'))
      throw e
    }
  }

  const { keyProvider, createClient } = openAICompatFor(api)
  if (!getApiKey(keyProvider)) throw new Error(missingApiKeyMessage(keyProvider))
  try {
    const completion = await createClient().chat.completions.create({
      model,
      messages: [{ role: 'user', content: instruction }],
    })
    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!text) throw new Error(`${keyProvider} returned empty text`)
    return text
  } catch (e) {
    if (isUnauthorizedError(e)) throw new Error(invalidApiKeyMessage(keyProvider))
    throw e
  }
}

export async function generatePromptFromImages(opts: {
  api: PromptGenAPI
  model: PromptGenModel
  imageBlobs: Blob[]
  instruction?: string
}): Promise<string> {
  const { api, model, imageBlobs } = opts
  const instructionTrim = opts.instruction?.trim()

  if (imageBlobs.length === 0) {
    if (!instructionTrim) {
      throw new Error('generatePromptFromImages: need images or a non-empty instruction')
    }
    return generatePromptTextOnly({ api, model, instruction: instructionTrim })
  }

  const instruction =
    instructionTrim || defaultInstructionForImageCount(imageBlobs.length)

  if (api === 'google') {
    if (!getApiKey('google')) throw new Error(missingApiKeyMessage('google'))
    try {
      const genModel = createGooglePromptClient().getGenerativeModel({ model })
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
        []
      for (const blob of imageBlobs) {
        const mime = blob.type || 'image/png'
        const data = await blobToBase64(blob)
        parts.push({ inlineData: { mimeType: mime, data } })
      }
      parts.push({ text: instruction })
      const result = await genModel.generateContent(parts)
      const text = result.response.text().trim()
      if (!text) throw new Error('Google vision returned empty text')
      return text
    } catch (e) {
      if (isUnauthorizedError(e)) throw new Error(invalidApiKeyMessage('google'))
      throw e
    }
  }

  const { keyProvider, createClient } = openAICompatFor(api)
  if (!getApiKey(keyProvider)) throw new Error(missingApiKeyMessage(keyProvider))
  try {
    const content: Array<
      | { type: 'image_url'; image_url: { url: string } }
      | { type: 'text'; text: string }
    > = []
    for (const blob of imageBlobs) {
      const mime = blob.type || 'image/png'
      const data = await blobToBase64(blob)
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${data}` },
      })
    }
    content.push({ type: 'text', text: instruction })

    const completion = await createClient().chat.completions.create({
      model,
      messages: [{ role: 'user', content }],
    })
    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!text) throw new Error(`${keyProvider} returned empty text`)
    return text
  } catch (e) {
    if (isUnauthorizedError(e)) throw new Error(invalidApiKeyMessage(keyProvider))
    throw e
  }
}
