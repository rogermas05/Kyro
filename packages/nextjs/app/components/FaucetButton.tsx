'use client'
import { useState } from 'react'

// Only rendered when NEXT_PUBLIC_USE_LOCAL=true
export function FaucetButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function handleDrip() {
    setState('loading')
    try {
      const win = window as Window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
      if (!win.ethereum) throw new Error('No wallet')

      const accounts = await win.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const address = accounts[0]

      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })

      const data = await res.json() as { hash?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Faucet error')

      setState('done')
      setMsg('1 ETH sent!')
      setTimeout(() => setState('idle'), 3000)
    } catch (e: unknown) {
      setState('error')
      setMsg((e as Error).message)
      setTimeout(() => setState('idle'), 4000)
    }
  }

  return (
    <button
      onClick={handleDrip}
      disabled={state === 'loading'}
      title="Send 1 test ETH to your connected wallet"
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.68rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        padding: '0.35rem 0.75rem',
        borderRadius: 6,
        border: '1px solid rgba(61,207,142,0.3)',
        background: state === 'done'
          ? 'rgba(61,207,142,0.15)'
          : state === 'error'
          ? 'rgba(255,82,82,0.1)'
          : 'rgba(61,207,142,0.07)',
        color: state === 'error' ? '#ff7575' : '#3dcf8e',
        cursor: state === 'loading' ? 'default' : 'pointer',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap' as const,
      }}
    >
      {state === 'loading' ? '⟳' : state === 'done' ? `✓ ${msg}` : state === 'error' ? `✗ ${msg.slice(0, 24)}` : '⛽ Faucet'}
    </button>
  )
}
