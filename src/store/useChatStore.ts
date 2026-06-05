import { create } from 'zustand'
import { nanoid } from 'nanoid'
import * as github from '../lib/github.ts'
import { streamChat } from '../lib/chat.ts'
import {
  CHAT_AGENTS,
  DEFAULT_CHAT_AGENT_ID,
  getChatAgent,
  isVisionModel,
} from '../lib/chatProviders.ts'
import type { ChatImageRef, ChatMessage, ChatProvider } from '../types/chat.ts'
import type { ChatContent } from '../lib/chat.ts'

function imageExtFromFile(file: File): string {
  const t = (file.type || '').toLowerCase()
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  if (t.includes('png')) return 'png'
  if (t.includes('webp')) return 'webp'
  if (t.includes('gif')) return 'gif'
  const raw = (file.name.split('.').pop() || '').toLowerCase()
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(raw) ? (raw === 'jpeg' ? 'jpg' : raw) : 'png'
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取图片失败'))
    r.readAsDataURL(file)
  })
}

let attachIdSeq = 0

export interface ChatAttachment {
  id: string
  file: File
  dataUrl: string
}

const LS_SPRITE_X = 'canvas-hello.chat.spriteX'
const LS_SPRITE_Y = 'canvas-hello.chat.spriteY'
const LS_AGENT = 'canvas-hello.chat.agent'
const LS_MODEL = 'canvas-hello.chat.model'

function readNum(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function readStr(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function initialAgent(): ChatProvider {
  const saved = readStr(LS_AGENT) as ChatProvider | null
  return saved && getChatAgent(saved) ? saved : DEFAULT_CHAT_AGENT_ID
}

function initialModel(agentId: ChatProvider): string {
  const agent = getChatAgent(agentId)
  const fallback = agent?.models[0]?.value ?? ''
  const saved = readStr(LS_MODEL)
  return saved && agent?.models.some((m) => m.value === saved) ? saved : fallback
}

interface ChatStoreState {
  panelOpen: boolean
  /** 屏幕坐标（fixed，非画布世界坐标）；null = 组件用默认右下角。 */
  spriteX: number | null
  spriteY: number | null
  messages: ChatMessage[]
  agentId: ChatProvider
  model: string
  status: 'idle' | 'sending'
  error: string | null
  loaded: boolean
  loading: boolean

  /** 输入框待发的图片附件（多模态）。 */
  attachments: ChatAttachment[]
  /** 历史/已发图片 ref.src → 可显示 URL（dataUrl 或 objectURL）缓存。 */
  chatImageUrls: Map<string, string>

  openPanel: () => void
  closePanel: () => void
  setSpritePos: (x: number, y: number) => void
  setAgent: (id: ChatProvider) => void
  setModel: (m: string) => void
  loadHistory: () => Promise<void>
  send: (text: string) => Promise<void>
  cancel: () => void
  clearMessages: () => Promise<void>
  addAttachments: (files: File[]) => Promise<void>
  removeAttachment: (id: string) => void
  registerChatImageUrl: (src: string, url: string) => void
}

let abortController: AbortController | null = null

export const useChatStore = create<ChatStoreState>((set, get) => ({
  panelOpen: false,
  spriteX: readNum(LS_SPRITE_X),
  spriteY: readNum(LS_SPRITE_Y),
  messages: [],
  agentId: initialAgent(),
  model: initialModel(initialAgent()),
  status: 'idle',
  error: null,
  loaded: false,
  loading: false,
  attachments: [],
  chatImageUrls: new Map(),

  openPanel: () => {
    set({ panelOpen: true })
    if (!get().loaded && !get().loading) void get().loadHistory()
  },
  closePanel: () => set({ panelOpen: false }),

  setSpritePos: (x, y) => {
    writeLS(LS_SPRITE_X, String(x))
    writeLS(LS_SPRITE_Y, String(y))
    set({ spriteX: x, spriteY: y })
  },

  setAgent: (id) => {
    const agent = getChatAgent(id)
    if (!agent) return
    const model = agent.models[0]?.value ?? ''
    writeLS(LS_AGENT, id)
    writeLS(LS_MODEL, model)
    // 切到非视觉模型则清掉待发图片，避免发出去 400。
    set((s) => ({ agentId: id, model, attachments: isVisionModel(id, model) ? s.attachments : [] }))
  },

  setModel: (m) => {
    writeLS(LS_MODEL, m)
    set((s) => ({ model: m, attachments: isVisionModel(s.agentId, m) ? s.attachments : [] }))
  },

  loadHistory: async () => {
    set({ loading: true })
    try {
      const data = await github.loadChat()
      set({ messages: data.messages, loaded: true, loading: false })
    } catch (e) {
      console.warn('[chat] loadHistory failed', e)
      set({ loaded: true, loading: false })
    }
  },

  send: async (text) => {
    const trimmed = text.trim()
    const atts = get().attachments
    if ((!trimmed && atts.length === 0) || get().status === 'sending') return

    const now = Date.now()
    const { agentId, model } = get()

    // 当前附件 → 图 ref + 上传资产 + 立即显示缓存
    const imageRefs: ChatImageRef[] = []
    const newAssets: { name: string; blob: Blob }[] = []
    const nextImageUrls = new Map(get().chatImageUrls)
    for (const a of atts) {
      const filename = `chat-${nanoid()}.${imageExtFromFile(a.file)}`
      const src = `_chat/assets/${filename}`
      imageRefs.push({ src, name: a.file.name })
      newAssets.push({ name: filename, blob: a.file })
      nextImageUrls.set(src, a.dataUrl)
    }

    const userMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: trimmed,
      images: imageRefs.length ? imageRefs : undefined,
      createdAt: now,
    }
    const assistantId = nanoid()
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      api: agentId,
      model,
      createdAt: now + 1,
    }

    // 历史轮纯文本；当前轮多模态（带图则用 data URL part 数组）
    const past: { role: 'user' | 'assistant'; content: ChatContent }[] = get().messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const currentContent: ChatContent = atts.length
      ? [
          ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
          ...atts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl } })),
        ]
      : trimmed
    const turns = [...past, { role: 'user' as const, content: currentContent }]

    set({
      messages: [...get().messages, userMsg, assistantMsg],
      status: 'sending',
      error: null,
      attachments: [],
      chatImageUrls: nextImageUrls,
    })

    abortController = new AbortController()
    try {
      await streamChat({
        agentId,
        model,
        messages: turns,
        signal: abortController.signal,
        onDelta: (delta) => {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m,
            ),
          }))
        },
      })
      set({ status: 'idle' })
      void github.saveChat({ messages: get().messages, updatedAt: Date.now() }, newAssets).catch((e) => {
        console.warn('[chat] saveChat failed', e)
      })
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError'
      const msg = aborted ? '已停止' : e instanceof Error ? e.message : '出错了'
      set((s) => ({
        status: 'idle',
        error: aborted ? null : msg,
        messages: s.messages.map((m) =>
          m.id === assistantId && m.content === ''
            ? { ...m, content: aborted ? '（已停止）' : `⚠ ${msg}` }
            : m,
        ),
      }))
      if (!aborted) {
        void github.saveChat({ messages: get().messages, updatedAt: Date.now() }, newAssets).catch(() => {})
      }
    } finally {
      abortController = null
    }
  },

  cancel: () => {
    abortController?.abort()
    abortController = null
    set({ status: 'idle' })
  },

  clearMessages: async () => {
    abortController?.abort()
    abortController = null
    set({ messages: [], status: 'idle', error: null, attachments: [] })
    try {
      await github.saveChat({ messages: [], updatedAt: Date.now() })
    } catch (e) {
      console.warn('[chat] clear saveChat failed', e)
    }
  },

  addAttachments: async (files) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    for (const file of imgs) {
      try {
        const dataUrl = await fileToDataUrl(file)
        attachIdSeq += 1
        const att: ChatAttachment = { id: `att-${attachIdSeq}`, file, dataUrl }
        set((s) => ({ attachments: [...s.attachments, att] }))
      } catch (e) {
        console.warn('[chat] read attachment failed', e)
      }
    }
  },

  removeAttachment: (id) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  registerChatImageUrl: (src, url) =>
    set((s) => {
      const next = new Map(s.chatImageUrls)
      next.set(src, url)
      return { chatImageUrls: next }
    }),
}))

export { CHAT_AGENTS }
