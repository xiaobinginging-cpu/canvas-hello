import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  allThreeApiKeysEmpty,
  API_KEYS_CHANGED_EVENT,
} from '../lib/apiKeys.ts'

export default function ApiKeysOnboardingBanner() {
  const navigate = useNavigate()
  const [show, setShow] = useState(false)

  const sync = useCallback(() => {
    setShow(allThreeApiKeysEmpty())
  }, [])

  useEffect(() => {
    sync()
    window.addEventListener(API_KEYS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(API_KEYS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [sync])

  if (!show) return null

  return (
    <div
      role="status"
      className="pointer-events-auto fixed left-1/2 top-3 z-[400] w-[min(92vw,560px)] -translate-x-1/2 rounded-lg border border-[#c9b8bb] bg-[#faf6f7] px-4 py-3 font-mono text-sm text-neutral-800 shadow-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 min-w-0 flex-1 leading-snug">请先去设置填 API key</p>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="shrink-0 rounded border border-[#5f7163] bg-[#5f7163] px-3 py-1.5 text-xs text-white hover:bg-[#4d5c50]"
        >
          打开设置
        </button>
      </div>
    </div>
  )
}
