import { useState } from 'react'
import * as github from '../../lib/github.ts'
import { useProjectStore } from '../../store/useStore.ts'

export default function PATSetup({ onConnected }: { onConnected: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setAuthAfterLogin = useProjectStore((s) => s.setAuthAfterLogin)

  async function handleSet(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      await github.setToken(value)
      setAuthAfterLogin()
      onConnected()
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-left">
      <h1 className="mb-2 font-mono text-xl font-medium tracking-tight text-neutral-900">
        Connect GitHub
      </h1>
      <p className="mb-8 font-mono text-sm leading-relaxed text-neutral-600">
        Generate a Personal Access Token at{' '}
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noreferrer"
          className="text-neutral-900 underline decoration-neutral-400 underline-offset-2"
        >
          https://github.com/settings/tokens
        </a>{' '}
        with <code className="rounded bg-neutral-200/80 px-1 py-0.5 text-xs">repo</code> scope (Full
        control of private repositories).
      </p>
      <label className="mb-2 block font-mono text-xs uppercase tracking-wide text-neutral-500">
        Token
      </label>
      <input
        type="password"
        autoComplete="off"
        placeholder="Paste GitHub PAT here"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mb-4 w-full rounded border border-neutral-300 bg-white px-3 py-2.5 font-mono text-sm text-neutral-900 outline-none ring-neutral-900 focus:ring-1"
      />
      {error ? <p className="mb-4 font-mono text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !value.trim()}
        onClick={() => void handleSet()}
        className="rounded border border-neutral-900 bg-neutral-900 px-5 py-2.5 font-mono text-sm text-white transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
      >
        {busy ? '…' : 'Set Token'}
      </button>
    </div>
  )
}
