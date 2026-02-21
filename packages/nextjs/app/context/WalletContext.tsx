'use client'
import { createContext, useContext, useState, useEffect } from 'react'
import { connectWallet, connectWithKey } from '../../lib/wallet'

type WalletCtx = {
  account: `0x${string}` | null
  setAccount: (a: `0x${string}` | null) => void
}

const WalletContext = createContext<WalletCtx>({ account: null, setAccount: () => {} })

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<`0x${string}` | null>(null)

  // Auto-reconnect on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (process.env.NEXT_PUBLIC_USE_LOCAL === 'true') {
      const savedKey = localStorage.getItem('wallet_active_key') as `0x${string}` | null
      if (savedKey) setAccount(connectWithKey(savedKey))
    } else {
      const win = window as Window & { ethereum?: { request: (a: { method: string }) => Promise<string[]> } }
      win.ethereum?.request({ method: 'eth_accounts' })
        .then(accounts => {
          if (accounts.length > 0) connectWallet().then(setAccount).catch(() => {})
        })
        .catch(() => {})
    }
  }, [])

  return (
    <WalletContext.Provider value={{ account, setAccount }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  return useContext(WalletContext)
}
