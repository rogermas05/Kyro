'use client'
import { useState, useEffect, useRef } from 'react'
import { useWallet } from '../context/WalletContext'
import {
  connectWallet, switchWallet, disconnectWallet, connectWithKey,
  discoverWallets, ANVIL_ACCOUNTS,
  type WalletProvider,
} from '../../lib/wallet'

export function WalletButton() {
  const { account, setAccount } = useWallet()
  const isLocal = process.env.NEXT_PUBLIC_USE_LOCAL === 'true'

  const [wallets, setWallets] = useState<WalletProvider[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    if (showPicker) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPicker])

  async function handleConnect() {
    if (isLocal) return
    setDiscovering(true)
    try {
      const found = await discoverWallets()
      if (found.length === 0) {
        alert('No wallet detected. Please install a browser wallet (e.g. MetaMask, Rabby, Coinbase Wallet).')
        return
      }
      if (found.length === 1) {
        const acct = await connectWallet(found[0])
        setAccount(acct)
        return
      }
      setWallets(found)
      setShowPicker(true)
    } catch (e) {
      console.error(e)
    } finally {
      setDiscovering(false)
    }
  }

  async function handlePickWallet(wallet: WalletProvider) {
    setShowPicker(false)
    try {
      const acct = await connectWallet(wallet)
      setAccount(acct)
    } catch (e) {
      console.error(e)
    }
  }

  async function handleSwitch() {
    try {
      const acct = await switchWallet()
      setAccount(acct)
    } catch (e) { console.error(e) }
  }

  function handleLocalConnect(key: `0x${string}`) {
    const addr = connectWithKey(key)
    try { localStorage.setItem('wallet_active_key', key) } catch { /* ignore */ }
    setAccount(addr)
  }

  function handleDisconnect() {
    disconnectWallet()
    try { localStorage.removeItem('wallet_active_key') } catch { /* ignore */ }
    setAccount(null)
  }

  if (account) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.75rem',
          color: 'var(--text-2)',
          padding: '0.3rem 0.65rem',
          background: 'rgba(0,53,95,0.4)',
          border: '1px solid var(--border-sub)',
          borderRadius: 6,
        }}>
          {account.slice(0, 6)}…{account.slice(-4)}
        </span>
        {!isLocal && (
          <button className="btn btn-ghost btn-sm" onClick={handleSwitch} style={{ marginTop: 0 }}>
            Switch
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={handleDisconnect} style={{ marginTop: 0 }}>
          Disconnect
        </button>
      </div>
    )
  }

  if (isLocal) {
    return (
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          Local:
        </span>
        {ANVIL_ACCOUNTS.map(a => (
          <button
            key={a.label}
            className="btn btn-secondary btn-sm"
            onClick={() => handleLocalConnect(a.key)}
            title={a.address}
            style={{ marginTop: 0 }}
          >
            {a.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }} ref={pickerRef}>
      <button
        className="btn btn-secondary btn-sm"
        onClick={handleConnect}
        disabled={discovering}
        style={{ marginTop: 0 }}
      >
        {discovering ? 'Detecting…' : 'Connect Wallet'}
      </button>

      {showPicker && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 0.5rem)',
          right: 0,
          background: 'var(--surface-2, #0a1929)',
          border: '1px solid var(--border-sub, #1e3a5f)',
          borderRadius: 10,
          padding: '0.5rem',
          minWidth: 220,
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            padding: '0.35rem 0.6rem',
            fontSize: '0.7rem',
            color: 'var(--text-2, #8899aa)',
            fontFamily: 'JetBrains Mono, monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Choose Wallet
          </div>
          {wallets.map(w => (
            <button
              key={w.rdns || w.name}
              onClick={() => handlePickWallet(w)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                width: '100%',
                padding: '0.55rem 0.6rem',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                color: 'var(--text-1, #e0e8f0)',
                fontSize: '0.85rem',
                textAlign: 'left',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {w.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={w.icon}
                  alt=""
                  width={24}
                  height={24}
                  style={{ borderRadius: 4 }}
                />
              )}
              <span>{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
