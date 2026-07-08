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
import { useProjectStore } from './useStore.ts'
import type { ChatImageRef, ChatMessage, ChatProvider, ChatSession } from '../types/chat.ts'
import type { ChatContent } from '../lib/chat.ts'

function currentProjectId(): string | null {
  return useProjectStore.getState().currentProjectId
}

function titleFrom(text: string): string {
  const t = text.trim()
  if (!t) return '新对话'
  return t.length > 24 ? `${t.slice(0, 24)}…` : t
}

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

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('解码图片失败'))
    img.src = src
  })
}

/**
 * 压缩聊天图片：长边压到 1568px + JPEG 0.85，避免大图 base64 撞 Vercel ~4.5MB body 上限（413）。
 * 已经够小的（≤1568px 且 <1MB）原样返回，避免无谓掉画质。
 */
const CHAT_IMG_MAX_PX = 1568
async function processChatImage(file: File): Promise<{ blob: Blob; dataUrl: string; ext: string }> {
  const dataUrl0 = await fileToDataUrl(file)
  let img: HTMLImageElement
  try {
    img = await loadImg(dataUrl0)
  } catch {
    return { blob: file, dataUrl: dataUrl0, ext: imageExtFromFile(file) }
  }
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  if (longest <= CHAT_IMG_MAX_PX && file.size <= 1_000_000) {
    return { blob: file, dataUrl: dataUrl0, ext: imageExtFromFile(file) }
  }
  const scale = Math.min(1, CHAT_IMG_MAX_PX / longest)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: file, dataUrl: dataUrl0, ext: imageExtFromFile(file) }
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
  if (!blob) return { blob: file, dataUrl: dataUrl0, ext: imageExtFromFile(file) }
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.85), ext: 'jpg' }
}

let attachIdSeq = 0

export interface ChatAttachment {
  id: string
  blob: Blob
  dataUrl: string
  name: string
  ext: string
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

  /** 已加载会话的 project（按项目分会话）。 */
  loadedProjectId: string | null
  sessions: ChatSession[]
  currentSessionId: string | null
  /** 历史会话列表浮层开关。 */
  showHistory: boolean

  agentId: ChatProvider
  model: string
  status: 'idle' | 'sending'
  error: string | null
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
  loadForProject: (projectId: string) => Promise<void>
  newSession: () => void
  switchSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
  toggleHistory: (v?: boolean) => void
  send: (text: string) => Promise<void>
  cancel: () => void
  addAttachments: (files: File[]) => Promise<void>
  removeAttachment: (id: string) => void
  registerChatImageUrl: (src: string, url: string) => void
}

let abortController: AbortController | null = null

export const useChatStore = create<ChatStoreState>((set, get) => ({
  panelOpen: false,
  spriteX: readNum(LS_SPRITE_X),
  spriteY: readNum(LS_SPRITE_Y),
  loadedProjectId: null,
  sessions: [],
  currentSessionId: null,
  showHistory: false,
  agentId: initialAgent(),
  model: initialModel(initialAgent()),
  status: 'idle',
  error: null,
  loading: false,
  attachments: [],
  chatImageUrls: new Map(),

  openPanel: () => {
    set({ panelOpen: true })
    const pid = currentProjectId()
    if (pid) void get().loadForProject(pid)
  },
  closePanel: () => set({ panelOpen: false, showHistory: false }),

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

  loadForProject: async (projectId) => {
    if (get().loadedProjectId === projectId && !get().loading) return
    set({ loading: true, loadedProjectId: projectId, sessions: [], currentSessionId: null, error: null })
    try {
      const data = await github.loadChat(projectId)
      // 快速 A→B 切换：晚返回的旧响应不能覆盖新项目的会话
      if (get().loadedProjectId !== projectId) return
      const sessions = [...data.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
      set({ sessions, currentSessionId: sessions[0]?.id ?? null, loading: false })
    } catch (e) {
      console.warn('[chat] loadForProject failed', e)
      // 回滚 loadedProjectId，否则下次 openPanel 早退、历史永远空白无法重试
      if (get().loadedProjectId === projectId) {
        set({ loading: false, loadedProjectId: null })
      }
    }
  },

  newSession: () =>
    set({ currentSessionId: null, showHistory: false, attachments: [], error: null }),

  switchSession: (id) => set({ currentSessionId: id, showHistory: false, error: null }),

  deleteSession: async (id) => {
    const projectId = currentProjectId()
    if (!projectId) return
    const sessions = get().sessions.filter((s) => s.id !== id)
    const currentSessionId =
      get().currentSessionId === id ? (sessions[0]?.id ?? null) : get().currentSessionId
    set({ sessions, currentSessionId })
    try {
      await github.saveChat(projectId, { sessions, updatedAt: Date.now() })
    } catch (e) {
      console.warn('[chat] deleteSession save failed', e)
    }
  },

  toggleHistory: (v) => set((s) => ({ showHistory: v ?? !s.showHistory })),

  send: async (text) => {
    const trimmed = text.trim()
    const atts = get().attachments
    if ((!trimmed && atts.length === 0) || get().status === 'sending') return
    const projectId = currentProjectId()
    if (!projectId) return

    const now = Date.now()
    const { agentId, model } = get()

    // 确保有当前会话（无则新建，不预建空会话）
    let sid = get().currentSessionId
    let sessions = get().sessions
    if (!sid || !sessions.some((s) => s.id === sid)) {
      sid = nanoid()
      sessions = [{ id: sid, title: '', messages: [], createdAt: now, updatedAt: now }, ...sessions]
    }
    const session = sessions.find((s) => s.id === sid)!

    // 当前附件 → 图 ref + 上传资产 + 立即显示缓存
    const imageRefs: ChatImageRef[] = []
    const newAssets: { name: string; blob: Blob }[] = []
    const nextImageUrls = new Map(get().chatImageUrls)
    for (const a of atts) {
      const filename = `chat-${nanoid()}.${a.ext}`
      const src = `_chat/assets/${filename}`
      imageRefs.push({ src, name: a.name })
      newAssets.push({ name: filename, blob: a.blob })
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

    // 历史轮取当前会话已有消息；视觉模型才带历史图（公开 URL，文本模型带图会 400 故纯文本）
    const visionOk = isVisionModel(agentId, model)
    const past: { role: 'user' | 'assistant'; content: ChatContent }[] = session.messages.map((m) => {
      if (visionOk && m.role === 'user' && m.images && m.images.length) {
        return {
          role: m.role,
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: github.getChatAssetUrl(img.src.split('/').pop() ?? '') },
            })),
          ],
        }
      }
      return { role: m.role, content: m.content }
    })
    const currentContent: ChatContent = atts.length
      ? [
          ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
          ...atts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl } })),
        ]
      : trimmed
    const turns = [...past, { role: 'user' as const, content: currentContent }]

    const nextTitle = session.title || titleFrom(trimmed || '[图片]')
    const withMsgs = sessions.map((s) =>
      s.id === sid
        ? { ...s, title: nextTitle, messages: [...s.messages, userMsg, assistantMsg], updatedAt: now }
        : s,
    )

    set({
      sessions: withMsgs,
      currentSessionId: sid,
      status: 'sending',
      error: null,
      attachments: [],
      chatImageUrls: nextImageUrls,
    })

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      set((st) => ({
        sessions: st.sessions.map((s) =>
          s.id === sid
            ? { ...s, messages: s.messages.map((m) => (m.id === assistantId ? fn(m) : m)) }
            : s,
        ),
      }))

    const persist = () => {
      // 流式期间可能已切项目：get().sessions 已是别的项目的会话，写回会覆盖本项目聊天史
      if (currentProjectId() !== projectId || get().loadedProjectId !== projectId) {
        console.warn('[chat] project changed during send, skip persist')
        return
      }
      void github
        .saveChat(projectId, { sessions: get().sessions, updatedAt: Date.now() }, newAssets)
        .catch((e) => console.warn('[chat] saveChat failed', e))
    }

    abortController = new AbortController()
    try {
      await streamChat({
        agentId,
        model,
        messages: turns,
        signal: abortController.signal,
        onDelta: (delta) => patchAssistant((m) => ({ ...m, content: m.content + delta })),
      })
      set({ status: 'idle' })
      persist()
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError'
      const msg = aborted ? '已停止' : e instanceof Error ? e.message : '出错了'
      patchAssistant((m) =>
        m.content === '' ? { ...m, content: aborted ? '（已停止）' : `⚠ ${msg}` } : m,
      )
      set({ status: 'idle', error: aborted ? null : msg })
      if (!aborted) persist()
    } finally {
      abortController = null
    }
  },

  cancel: () => {
    abortController?.abort()
    abortController = null
    set({ status: 'idle' })
  },

  addAttachments: async (files) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    for (const file of imgs) {
      try {
        const { blob, dataUrl, ext } = await processChatImage(file)
        attachIdSeq += 1
        const att: ChatAttachment = { id: `att-${attachIdSeq}`, blob, dataUrl, name: file.name, ext }
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
