import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  API_KEYS_CHANGED_EVENT,
  getApiKey,
  setApiKey,
  type ApiKeyProvider,
} from '../../lib/apiKeys.ts'
import Logo from '../Logo.tsx'

const SAGE_LINK =
  'text-[#5f7163] underline decoration-[#5f7163]/40 underline-offset-2 hover:text-[#4a5a4e]'

const SAGE_BTN =
  'rounded-lg border border-[#5f7163] bg-white px-3 py-2 text-xs font-medium text-[#5f7163] transition-colors hover:bg-[#5f7163]/10'

const SAGE_BTN_SOLID =
  'rounded-lg border border-[#5f7163] bg-[#5f7163] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#4d5c50]'

const MASK = '•'.repeat(40)

const EMPTY_STORED: Record<ApiKeyProvider, string> = {
  google: '',
  kimi: '',
  apimart: '',
}

const KEY_FIELDS: {
  provider: ApiKeyProvider
  label: string
  helpUrl: string
  helpLabel: string
}[] = [
  {
    provider: 'google',
    label: 'Google AI Studio',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    helpLabel: '去哪拿 key →',
  },
  {
    provider: 'kimi',
    label: 'Kimi（Moonshot）',
    helpUrl: 'https://platform.moonshot.cn/console/api-keys',
    helpLabel: '去哪拿 key →',
  },
  {
    provider: 'apimart',
    label: 'APIMart',
    helpUrl: 'https://apimart.ai/keys',
    helpLabel: '去哪拿 key →',
  },
]

export default function SettingsPage() {
  const [stored, setStored] = useState<Record<ApiKeyProvider, string>>(EMPTY_STORED)
  const [editing, setEditing] = useState<Record<ApiKeyProvider, boolean>>({
    google: false,
    kimi: false,
    apimart: false,
  })
  const [draft, setDraft] = useState<Record<ApiKeyProvider, string>>(EMPTY_STORED)
  const [visible, setVisible] = useState<Record<ApiKeyProvider, boolean>>({
    google: false,
    kimi: false,
    apimart: false,
  })
  const [nameSuffix, setNameSuffix] = useState<Record<ApiKeyProvider, string>>(EMPTY_STORED)

  const reloadFromStorage = useCallback(() => {
    setStored({
      google: getApiKey('google') ?? '',
      kimi: getApiKey('kimi') ?? '',
      apimart: getApiKey('apimart') ?? '',
    })
  }, [])

  useEffect(() => {
    reloadFromStorage()
    const onChange = () => reloadFromStorage()
    window.addEventListener(API_KEYS_CHANGED_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(API_KEYS_CHANGED_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [reloadFromStorage])

  const startEdit = (provider: ApiKeyProvider) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setNameSuffix((prev) => ({ ...prev, [provider]: id }))
    setDraft((prev) => ({ ...prev, [provider]: '' }))
    setVisible((prev) => ({ ...prev, [provider]: false }))
    setEditing((prev) => ({ ...prev, [provider]: true }))
  }

  const saveEdit = (provider: ApiKeyProvider) => {
    setApiKey(provider, draft[provider])
    setEditing((prev) => ({ ...prev, [provider]: false }))
    reloadFromStorage()
  }

  const cancelEdit = (provider: ApiKeyProvider) => {
    setDraft((prev) => ({ ...prev, [provider]: '' }))
    setEditing((prev) => ({ ...prev, [provider]: false }))
  }

  return (
    <div className="min-h-svh bg-[#FAF8F5] font-mono text-neutral-900">
      <header className="flex shrink-0 items-center justify-between border-b border-[#d4c8c9]/80 bg-[#FAF8F5] px-8 py-5">
        <Link to="/" className="flex shrink-0 items-center gap-3 text-sm text-neutral-600 hover:text-neutral-900">
          <span aria-hidden>←</span>
          <Logo variant="solid" size={32} />
        </Link>
        <h1 className="text-sm font-medium tracking-tight text-neutral-800">API 密钥</h1>
      </header>

      <main className="mx-auto max-w-lg px-6 py-12 text-left">
        <p className="mb-10 text-sm leading-relaxed text-neutral-600">
          密钥仅保存在本机浏览器的 <code className="rounded bg-[#ebe4e5]/60 px-1 py-0.5 text-xs">localStorage</code>
          ，不会上传到 canvas-hello 服务器。GitHub PAT 仍在首页单独配置。
        </p>

        <div className="flex flex-col gap-10">
          {KEY_FIELDS.map(({ provider, label, helpUrl, helpLabel }) => {
            const isEdit = editing[provider]
            const hasStored = Boolean(stored[provider])

            return (
              <div key={provider} className="flex flex-col gap-2">
                <label className="text-xs uppercase tracking-wide text-neutral-500">{label}</label>

                {!isEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      disabled
                      type="text"
                      tabIndex={-1}
                      value={hasStored ? MASK : ''}
                      placeholder="未配置"
                      className="min-w-0 flex-1 cursor-default rounded-lg border border-[#d4c8c9] bg-[#faf6f7] py-2.5 pl-3 pr-3 text-sm tracking-widest text-neutral-700 outline-none disabled:opacity-100"
                      aria-label={`${label}（已配置，点击修改可更换）`}
                    />
                    <button type="button" onClick={() => startEdit(provider)} className={SAGE_BTN}>
                      修改
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="relative flex w-full min-w-0">
                      <input
                        key={`edit-${provider}-${nameSuffix[provider]}`}
                        type={visible[provider] ? 'text' : 'password'}
                        name={`canvas-api-key-${provider}-${nameSuffix[provider]}`}
                        autoComplete="new-password"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        value={draft[provider]}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [provider]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-[#d4c8c9] bg-white py-2.5 pl-3 pr-11 text-sm text-neutral-900 outline-none ring-[#5f7163]/30 placeholder:text-neutral-400 focus:ring-2"
                        placeholder="粘贴新的 API key"
                      />
                      <button
                        type="button"
                        title={visible[provider] ? '隐藏' : '显示'}
                        aria-label={visible[provider] ? '隐藏密钥' : '显示密钥'}
                        onClick={() =>
                          setVisible((prev) => ({ ...prev, [provider]: !prev[provider] }))
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                      >
                        {visible[provider] ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => saveEdit(provider)} className={SAGE_BTN_SOLID}>
                        保存
                      </button>
                      <button type="button" onClick={() => cancelEdit(provider)} className={SAGE_BTN}>
                        取消
                      </button>
                    </div>
                  </div>
                )}

                <a
                  href={helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`text-xs ${SAGE_LINK}`}
                >
                  {helpLabel}
                </a>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
