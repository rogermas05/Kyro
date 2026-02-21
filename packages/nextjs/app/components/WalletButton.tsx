'use client'
import { useWallet } from '../context/WalletContext'
import { connectWallet, switchWallet, disconnectWallet, connectWithKey, ANVIL_ACCOUNTS } from '../../lib/wallet'

export function WalletButton() {
  const { account, setAccount } = useWallet()
  const isLocal = process.env.NEXT_PUBLIC_USE_LOCAL === 'true'

  async function handleConnect() {
    try {
      const acct = await connectWallet()
      setAccount(acct)
    } catch (e) { console.error(e) }
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
    <button className="btn btn-secondary btn-sm" onClick={handleConnect} style={{ marginTop: 0 }}>
      Connect Wallet
    </button>
  )
}
