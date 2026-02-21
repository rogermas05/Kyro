'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { connectWithKey, getPublicClient } from '../../lib/wallet'
import { predictSmartAccountAddress, isAccountDeployed, FACTORY } from '../../lib/smart-account'

type WalletCtx = {
  account: `0x${string}` | null
  setAccount: (a: `0x${string}` | null) => void
  smartAccount: `0x${string}` | null
  smartAccountDeployed: boolean
  refreshSmartAccount: () => Promise<void>
}

const WalletContext = createContext<WalletCtx>({
  account: null,
  setAccount: () => {},
  smartAccount: null,
  smartAccountDeployed: false,
  refreshSmartAccount: async () => {},
})

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccountState] = useState<`0x${string}` | null>(null)
  const [smartAccount, setSmartAccount] = useState<`0x${string}` | null>(null)
  const [smartAccountDeployed, setSmartAccountDeployed] = useState(false)

  const refreshSmartAccount = useCallback(async () => {
    if (!account || FACTORY === ZERO_ADDR) {
      setSmartAccount(null)
      setSmartAccountDeployed(false)
      return
    }
    try {
      const pc = getPublicClient()
      const predicted = await predictSmartAccountAddress(pc, account)
      setSmartAccount(predicted)
      const deployed = await isAccountDeployed(pc, predicted)
      setSmartAccountDeployed(deployed)
    } catch {
      setSmartAccount(null)
      setSmartAccountDeployed(false)
    }
  }, [account])

  const setAccount = useCallback((a: `0x${string}` | null) => {
    setAccountState(a)
  }, [])

  useEffect(() => {
    refreshSmartAccount()
  }, [refreshSmartAccount])

  // Auto-reconnect on mount using whatever wallet was last connected
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (process.env.NEXT_PUBLIC_USE_LOCAL === 'true') {
      const savedKey = localStorage.getItem('wallet_active_key') as `0x${string}` | null
      if (savedKey) setAccountState(connectWithKey(savedKey))
    } else {
      import('../../lib/wallet').then(({ discoverWallets, connectWallet: connect }) => {
        discoverWallets().then(wallets => {
          if (wallets.length === 0) return
          const first = wallets[0]
          first.provider.request({ method: 'eth_accounts' })
            .then(accounts => {
              if ((accounts as string[]).length > 0) connect(first).then(setAccountState).catch(() => {})
            })
            .catch(() => {})
        }).catch(() => {})
      })
    }
  }, [])

  return (
    <WalletContext.Provider value={{ account, setAccount, smartAccount, smartAccountDeployed, refreshSmartAccount }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  return useContext(WalletContext)
}
