import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ImagePlus, Send, Square, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'
import { hasApiKey } from '../../lib/apiKeys.ts'
import { getChatAgent, isVisionModel } from '../../lib/chatProviders.ts'
import * as github from '../../lib/github.ts'
import { CHAT_AGENTS, useChatStore } from '../../store/useChatStore.ts'
import { useEffectiveUserLabel } from '../../hooks/useEffectiveUserLabel.ts'
import type { ChatImageRef } from '../../types/chat.ts'

function filenameFromSrc(src: string): string {
  return src.split('/').filter(Boolean).pop() ?? ''
}

/** 消息里的图：先用 store 缓存（刚发的 dataUrl），没有则按 ref 拉 `_chat/assets/` → objectURL。 */
function ChatImage({ imageRef }: { imageRef: ChatImageRef }) {
  const cached = useChatStore((s) => s.chatImageUrls.get(imageRef.src))
  const register = useChatStore((s) => s.registerChatImageUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // 已有缓存（刚发的 dataUrl 或别处已拉过）就不重复拉。读 store 而非靠 cached 依赖，
    // 避免 register 后 cached 变化触发 cleanup 把刚建的 objectURL revoke 掉（刷新后图裂的根因）。
    if (useChatStore.getState().chatImageUrls.get(imageRef.src)) return
    let cancelled = false
    void (async () => {
      try {
        const blob = await github.fetchChatAsset(filenameFromSrc(imageRef.src))
        if (cancelled) return
        register(imageRef.src, URL.createObjectURL(blob))
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [imageRef.src, register])

  if (failed) {
    return <span className="text-[10px] text-neutral-400">图片加载失败</span>
  }
  if (!cached) {
    return <span className="text-[10px] text-neutral-300">…</span>
  }
  return (
    <img
      src={cached}
      alt={imageRef.name ?? ''}
      className="rounded border border-neutral-200 object-contain"
      style={{ maxHeight: 160, maxWidth: 200 }}
    />
  )
}

/** 发光小球（面板头/空态用，同小精灵观感：绿色辉光 + 形状蠕动 + 变色；无漂浮）。 */
function MiniSprite({ size }: { size: number }) {
  const eye = { width: size * 0.11, height: size * 0.15 }
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span className="chat-sprite-glow absolute inset-0" />
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{ paddingBottom: size * 0.3 }}
      >
        <span className="flex items-center" style={{ gap: size * 0.13 }}>
          <span className="block rounded-full bg-neutral-900" style={eye} />
          <span className="block rounded-full bg-neutral-900" style={eye} />
        </span>
      </span>
    </span>
  )
}

export default function ChatPanel() {
  const panelOpen = useChatStore((s) => s.panelOpen)
  const closePanel = useChatStore((s) => s.closePanel)
  const messages = useChatStore((s) => s.messages)
  const agentId = useChatStore((s) => s.agentId)
  const model = useChatStore((s) => s.model)
  const status = useChatStore((s) => s.status)
  const error = useChatStore((s) => s.error)
  const loading = useChatStore((s) => s.loading)
  const setAgent = useChatStore((s) => s.setAgent)
  const setModel = useChatStore((s) => s.setModel)
  const send = useChatStore((s) => s.send)
  const cancel = useChatStore((s) => s.cancel)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const attachments = useChatStore((s) => s.attachments)
  const addAttachments = useChatStore((s) => s.addAttachments)
  const removeAttachment = useChatStore((s) => s.removeAttachment)

  const userLabel = useEffectiveUserLabel()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, panelOpen])

  if (!panelOpen) return null

  const agent = getChatAgent(agentId)
  const keyOk = agent ? hasApiKey(agent.keyProvider) : false
  const sending = status === 'sending'
  const visionOk = isVisionModel(agentId, model)

  const canSend = (draft.trim() !== '' || attachments.length > 0) && !sending

  function submit(): void {
    if (!canSend) return
    const t = draft
    setDraft('')
    void send(t)
  }

  return (
    <div className="fixed right-0 top-0 z-[180] flex h-svh w-[min(92vw,380px)] flex-col border-l border-neutral-200 bg-[#FAF8F5] font-mono text-neutral-900 shadow-xl">
      {/* header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3">
        <MiniSprite size={26} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <select
            value={agentId}
            onChange={(e) => setAgent(e.target.value as typeof agentId)}
            className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs text-neutral-900"
            title="切换智能体"
          >
            {CHAT_AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs text-neutral-900"
            title="模型"
          >
            {(agent?.models ?? []).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          title="清空对话"
          onClick={() => void clearMessages()}
          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800"
        >
          <Trash2 size={15} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          title="收起"
          onClick={closePanel}
          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800"
        >
          <ChevronRight size={18} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {!keyOk ? (
        <Link
          to="/settings"
          className="shrink-0 border-b border-[#c9b8bb] bg-[#faf6f7] px-4 py-2 text-xs text-neutral-800 underline decoration-[#5f7163]/50 underline-offset-2 hover:decoration-[#5f7163]"
        >
          {agent?.label} 还没配 API key，去设置 →
        </Link>
      ) : null}

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="text-center text-xs text-neutral-400">加载历史…</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-4 pt-16 text-center">
            <MiniSprite size={48} />
            <div>
              <p className="text-sm text-neutral-500">Hi {userLabel}</p>
              <p className="mt-1 text-lg font-medium text-neutral-900">今天聊点什么？</p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={`flex max-w-[85%] flex-col gap-1.5 ${
                    m.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  {/* 图片裸放、不裹气泡 */}
                  {m.images?.map((img) => <ChatImage key={img.src} imageRef={img} />)}
                  {/* 文字才进气泡；纯图消息不显示空气泡 */}
                  {m.content ? (
                    <div
                      className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'whitespace-pre-wrap break-words bg-neutral-900 text-white'
                          : 'chat-md border border-neutral-200 bg-white text-neutral-900'
                      }`}
                    >
                      {m.role === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      ) : (
                        m.content
                      )}
                    </div>
                  ) : sending && m.role === 'assistant' ? (
                    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
                      <span className="animate-pulse text-neutral-400">▋</span>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p className="shrink-0 border-t border-red-200 bg-red-50/80 px-4 py-2 text-xs text-red-900">
          {error}
        </p>
      ) : null}

      {/* input */}
      <div className="shrink-0 border-t border-neutral-200 p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            if (files?.length) void addAttachments(Array.from(files))
            e.target.value = ''
          }}
        />

        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="relative h-14 w-14 overflow-hidden rounded border border-neutral-200 bg-neutral-100"
              >
                <img src={a.dataUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  title="移除"
                  onClick={() => removeAttachment(a.id)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-lg border border-neutral-300 bg-white px-2 py-1.5">
          <button
            type="button"
            title={visionOk ? '加图片' : '当前模型不支持图片，换视觉模型（如 Gemini / Qwen3.7 Plus / GLM-5V）'}
            disabled={!visionOk}
            onClick={() => fileRef.current?.click()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ImagePlus size={16} strokeWidth={2} aria-hidden />
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"
            className="max-h-32 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          {sending ? (
            <button
              type="button"
              title="停止"
              onClick={cancel}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-white hover:bg-neutral-800"
            >
              <Square size={14} strokeWidth={2} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              title="发送"
              disabled={!canSend}
              onClick={submit}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              <Send size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
