import { create } from 'zustand'
import { nanoid } from 'nanoid'
import * as github from '../lib/github.ts'
import { streamChat } from '../lib/chat.ts'
import { CHAT_AGENTS, DEFAULT_CHAT_AGENT_ID, getChatAgent } from '../lib/chatProviders.ts'
import type { ChatMessage, ChatProvider } from '../types/chat.ts'

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

  openPanel: () => void
  closePanel: () => void
  setSpritePos: (x: number, y: number) => void
  setAgent: (id: ChatProvider) => void
  setModel: (m: string) => void
  loadHistory: () => Promise<void>
  send: (text: string) => Promise<void>
  cancel: () => void
  clearMessages: () => Promise<void>
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
    set({ agentId: id, model })
  },

  setModel: (m) => {
    writeLS(LS_MODEL, m)
    set({ model: m })
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
    if (!trimmed || get().status === 'sending') return

    const now = Date.now()
    const { agentId, model } = get()
    const userMsg: ChatMessage = { id: nanoid(), role: 'user', content: trimmed, createdAt: now }
    const assistantId = nanoid()
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      api: agentId,
      model,
      createdAt: now + 1,
    }

    const turns = [...get().messages, userMsg].map((m) => ({ role: m.role, content: m.content }))

    set({
      messages: [...get().messages, userMsg, assistantMsg],
      status: 'sending',
      error: null,
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
      void github.saveChat({ messages: get().messages, updatedAt: Date.now() }).catch((e) => {
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
        void github.saveChat({ messages: get().messages, updatedAt: Date.now() }).catch(() => {})
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
    set({ messages: [], status: 'idle', error: null })
    try {
      await github.saveChat({ messages: [], updatedAt: Date.now() })
    } catch (e) {
      console.warn('[chat] clear saveChat failed', e)
    }
  },
}))

export { CHAT_AGENTS }
