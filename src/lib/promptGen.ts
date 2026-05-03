import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

function kimiBaseURL(): string {
  if (!import.meta.env.DEV) return 'https://api.moonshot.cn/v1'
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/kimi/v1`
  }
  return 'http://localhost:5273/api/kimi/v1'
}

const kimi = new OpenAI({
  apiKey: import.meta.env.VITE_KIMI_API_KEY,
  baseURL: kimiBaseURL(),
  dangerouslyAllowBrowser: true,
})

const google = new GoogleGenerativeAI(import.meta.env.VITE_GOOGLE_API_KEY ?? '')

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
  const k = import.meta.env.VITE_KIMI_API_KEY
  return typeof k === 'string' && k.trim() !== ''
}

export async function generatePromptFromImages(opts: {
  api: PromptGenAPI
  model: PromptGenModel
  imageBlobs: Blob[]
  instruction?: string
}): Promise<string> {
  const { api, model, imageBlobs } = opts
  if (imageBlobs.length === 0) {
    throw new Error('generatePromptFromImages: imageBlobs is empty')
  }

  const instruction =
    opts.instruction?.trim() || defaultInstructionForImageCount(imageBlobs.length)

  if (api === 'google') {
    const genModel = google.getGenerativeModel({ model })
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
  }

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

  const completion = await kimi.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
  })
  const text = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error('Kimi returned empty text')
  return text
}
