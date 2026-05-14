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

export type PromptGenAPI = 'google' | 'kimi'

export type GooglePromptVisionModel =
  | 'gemini-3.1-flash-lite-preview'
  | 'gemini-3-flash-preview'
  | 'gemini-3.1-pro-preview'

export type PromptGenModel = GooglePromptVisionModel | 'kimi-k2.6'

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

  if (!getApiKey('kimi')) throw new Error(missingApiKeyMessage('kimi'))
  try {
    const completion = await createKimiClient().chat.completions.create({
      model,
      messages: [{ role: 'user', content: instruction }],
    })
    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!text) throw new Error('Kimi returned empty text')
    return text
  } catch (e) {
    if (isUnauthorizedError(e)) throw new Error(invalidApiKeyMessage('kimi'))
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

  if (!getApiKey('kimi')) throw new Error(missingApiKeyMessage('kimi'))
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

    const completion = await createKimiClient().chat.completions.create({
      model,
      messages: [{ role: 'user', content }],
    })
    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    if (!text) throw new Error('Kimi returned empty text')
    return text
  } catch (e) {
    if (isUnauthorizedError(e)) throw new Error(invalidApiKeyMessage('kimi'))
    throw e
  }
}
