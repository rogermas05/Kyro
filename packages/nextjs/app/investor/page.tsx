'use client'
import { useState, useEffect } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { connectWallet, connectWithKey, getPublicClient, getWalletClient, ANVIL_ACCOUNTS } from '../../lib/wallet'
import { VAULT_ABI, ERC20_ABI } from '../../lib/abis'

const VAULT = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const DDSC  = (process.env.NEXT_PUBLIC_DDSC_ADDRESS  ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO  = '0x0000000000000000000000000000000000000000'

// Share price = convertToAssets(1 full share unit). Starts at 1e18 (1.0 DDSC), rises as invoices settle.
const ONE_SHARE = parseUnits('1', 18)

interface Stats {
  totalAssets: bigint  // vault totalAssets() = cash + S-DEBT at par
  vaultCash:   bigint  // DDSC.balanceOf(vault) = idle liquidity
  sharePrice:  bigint  // convertToAssets(1e18) — DDSC value of one share, 18-dec
  myShares:    bigint  // investor's KYRO share balance
  myDDSC:      bigint  // convertToAssets(myShares) — redemption value
  ddscBalance: bigint  // investor's wallet DDSC (available to deposit)
}

export default function InvestorPage() {
  const [account,    setAccount]    = useState<`0x${string}` | null>(null)
  const [stats,      setStats]      = useState<Stats | null>(null)
  const [depositAmt, setDepositAmt] = useState('1000')
  const [mintAmt,    setMintAmt]    = useState('10000')
  const [status,     setStatus]     = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [minting,    setMinting]    = useState(false)

  async function handleConnect() {
    try {
      const acct = await connectWallet()
      setAccount(acct)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  function handleLocalConnect(key: `0x${string}`) {
    setAccount(connectWithKey(key))
  }

  async function loadStats(acct: `0x${string}`) {
    if (VAULT === ZERO) return
    try {
      const pub = getPublicClient()
      const [totalAssets, vaultCash, sharePrice, myShares, ddscBalance] = await Promise.all([
        pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' }),
        pub.readContract({ address: DDSC,  abi: ERC20_ABI, functionName: 'balanceOf', args: [VAULT] }),
        pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets', args: [ONE_SHARE] }),
        pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'balanceOf', args: [acct] }),
        pub.readContract({ address: DDSC,  abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] }),
      ])
      const myDDSC = myShares > 0n
        ? await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets', args: [myShares] })
        : 0n
      setStats({ totalAssets, vaultCash, sharePrice, myShares, myDDSC, ddscBalance })
    } catch { /* ignore if contracts not yet deployed */ }
  }

  useEffect(() => {
    if (account) loadStats(account)
  }, [account])

  // ── Mint DDSC (local dev only) ─────────────────────────────────────────────

  async function handleMintDDSC() {
    if (!account) return setStatus({ msg: 'Connect wallet first.', type: 'error' })
    setMinting(true)
    setStatus({ msg: `Minting ${Number(mintAmt).toLocaleString()} DDSC…`, type: 'info' })
    try {
      const res  = await fetch('/api/mint-ddsc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account, amount: mintAmt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Mint failed')
      setStatus({ msg: `Minted ${Number(mintAmt).toLocaleString()} DDSC to your wallet.`, type: 'success' })
      await loadStats(account)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    } finally {
      setMinting(false)
    }
  }

  // ── Deposit ────────────────────────────────────────────────────────────────

  async function handleDeposit() {
    if (!account) return setStatus({ msg: 'Connect wallet first.', type: 'error' })
    if (VAULT === ZERO) return setStatus({ msg: 'NEXT_PUBLIC_VAULT_ADDRESS not set.', type: 'error' })
    setStatus({ msg: 'Registering with KYC registry…', type: 'info' })
    try {
      // Auto-KYC: vault.deposit() gates on isVerified(receiver)
      await fetch('/api/register-sme', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: account }),
      })

      const amount = parseUnits(depositAmt, 18)
      const wallet = getWalletClient(account)
      const pub    = getPublicClient()

      setStatus({ msg: 'Approving DDSC…', type: 'info' })
      const approveTx = await wallet.writeContract({
        address: DDSC, abi: ERC20_ABI, functionName: 'approve', args: [VAULT, amount],
      })
      await pub.waitForTransactionReceipt({ hash: approveTx })

      setStatus({ msg: 'Depositing into vault…', type: 'info' })
      const depositTx = await wallet.writeContract({
        address: VAULT, abi: VAULT_ABI, functionName: 'deposit', args: [amount, account],
      })
      await pub.waitForTransactionReceipt({ hash: depositTx })

      setStatus({ msg: `Deposit complete. You now hold KYRO vault shares — yield accrues automatically as invoices settle.`, type: 'success' })
      await loadStats(account)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  // ── Redeem ─────────────────────────────────────────────────────────────────

  async function handleRedeem() {
    if (!account || !stats?.myShares) return
    setStatus({ msg: 'Redeeming shares…', type: 'info' })
    try {
      const wallet = getWalletClient(account)
      const pub    = getPublicClient()
      const hash   = await wallet.writeContract({
        address: VAULT, abi: VAULT_ABI, functionName: 'redeem',
        args: [stats.myShares, account, account],
      })
      await pub.waitForTransactionReceipt({ hash })
      setStatus({ msg: `Redemption complete — DDSC returned to your wallet.`, type: 'success' })
      await loadStats(account)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  // ── Derived metrics ────────────────────────────────────────────────────────

  const fmt2  = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString('en', { maximumFractionDigits: 2 })
  const fmt0  = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString('en', { maximumFractionDigits: 0 })
  const isLocal = process.env.NEXT_PUBLIC_USE_LOCAL === 'true'

  // Share price in DDSC (18-decimal). e.g. 1.25e18 → 1.25
  const sharePriceNum = stats ? Number(formatUnits(stats.sharePrice, 18)) : 1
  // Yield earned since inception (share price appreciation)
  const yieldPct      = ((sharePriceNum - 1) * 100).toFixed(2)
  const yieldPositive = sharePriceNum > 1
  // Capital deployed in active invoices (S-DEBT at par = totalAssets - vaultCash)
  const deployed      = stats ? (stats.totalAssets > stats.vaultCash ? stats.totalAssets - stats.vaultCash : 0n) : 0n
  // Utilization %
  const utilPct       = stats && stats.totalAssets > 0n
    ? Math.round(Number(deployed * 100n / stats.totalAssets))
    : 0

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header fade-up">
        <div className="eyebrow">Investor Portal</div>
        <h1>Kyro Vault</h1>
        <p className="subtitle">
          Deposit DDSC, earn yield as SME invoices settle.
        </p>
      </div>

      {/* Wallet */}
      <div className="fade-up-1">
        {account ? (
          <p className="account">{account}</p>
        ) : isLocal ? (
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem', fontFamily: 'JetBrains Mono, monospace' }}>
              Local mode — pick an Anvil test account:
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
              {ANVIL_ACCOUNTS.map(a => (
                <button key={a.label} className="btn btn-secondary" onClick={() => handleLocalConnect(a.key)}
                  title={a.address} style={{ marginTop: 0 }}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={handleConnect} style={{ marginTop: 0 }}>
            Connect Wallet
          </button>
        )}
      </div>

      {/* Contracts not deployed */}
      {VAULT === ZERO && (
        <div className="card fade-up-2" style={{ borderColor: 'rgba(244,120,32,0.3)' }}>
          <p style={{ fontSize: '0.88rem', color: 'var(--orange)' }}>
            ⚠ Set NEXT_PUBLIC_VAULT_ADDRESS and NEXT_PUBLIC_DDSC_ADDRESS in .env.local after running deploy scripts.
          </p>
        </div>
      )}

      {/* ── Vault Performance ─────────────────────────────────────────────────── */}
      {stats && (
        <div className="card fade-up-2">
          <h2>Vault Performance</h2>

          {/* Share price hero */}
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: '0.75rem',
            padding: '1.25rem 1.25rem 1rem',
            background: 'rgba(0,53,95,0.35)', borderRadius: 10, border: '1px solid var(--border-sub)',
            marginBottom: '1.25rem',
          }}>
            <div>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: '0.35rem' }}>
                Share Price
              </div>
              <div style={{ fontSize: '2rem', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>
                {sharePriceNum.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.3rem' }}>DDSC per KYRO share</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' as const }}>
              <div style={{
                display: 'inline-block', padding: '0.3rem 0.75rem', borderRadius: 6,
                fontSize: '0.82rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                color: yieldPositive ? 'var(--success)' : 'var(--muted)',
                background: yieldPositive ? 'rgba(61,207,142,0.1)' : 'rgba(0,0,0,0.2)',
                border: `1px solid ${yieldPositive ? 'rgba(61,207,142,0.3)' : 'var(--border-sub)'}`,
              }}>
                {yieldPositive ? '+' : ''}{yieldPct}% since inception
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
                Target: 25% per invoice cycle
              </div>
            </div>
          </div>

          {/* Vault metrics grid */}
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Total Assets</div>
              <div className="stat-value">{fmt0(stats.totalAssets)}</div>
              <div className="stat-unit">DDSC</div>
            </div>
            <div className="stat">
              <div className="stat-label">Deployed Capital</div>
              <div className="stat-value">{fmt0(deployed)}</div>
              <div className="stat-unit">DDSC in invoices</div>
            </div>
            <div className="stat">
              <div className="stat-label">Idle Cash</div>
              <div className="stat-value">{fmt0(stats.vaultCash)}</div>
              <div className="stat-unit">DDSC available</div>
            </div>
            <div className="stat">
              <div className="stat-label">Utilization</div>
              <div className="stat-value">{utilPct}</div>
              <div className="stat-unit">% deployed</div>
            </div>
          </div>

          {/* Utilization bar */}
          {stats.totalAssets > 0n && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>
                <span>Deployed in active invoices</span>
                <span>{utilPct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(0,0,0,0.3)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${utilPct}%`, background: 'linear-gradient(90deg, var(--orange), #f4a020)', borderRadius: 4, transition: 'width 0.5s ease' }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Your Position ──────────────────────────────────────────────────────── */}
      {stats && (
        <div className="card fade-up-3">
          <h2>Your Position</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Your Shares</div>
              <div className="stat-value">{fmt2(stats.myShares)}</div>
              <div className="stat-unit">KYRO</div>
            </div>
            <div className="stat">
              <div className="stat-label">Redemption Value</div>
              <div className="stat-value">{fmt2(stats.myDDSC)}</div>
              <div className="stat-unit">DDSC</div>
            </div>
            <div className="stat">
              <div className="stat-label">Your Yield</div>
              <div className="stat-value" style={{ color: yieldPositive ? 'var(--success)' : 'var(--muted)' }}>
                {stats.myShares > 0n ? fmt2(stats.myDDSC > stats.myShares ? stats.myDDSC - stats.myShares : 0n) : '—'}
              </div>
              <div className="stat-unit">DDSC earned</div>
            </div>
            <div className="stat">
              <div className="stat-label">Wallet Balance</div>
              <div className="stat-value">{fmt2(stats.ddscBalance)}</div>
              <div className="stat-unit">DDSC</div>
            </div>
          </div>

          {stats.myShares === 0n && (
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: '0.75rem', textAlign: 'center' as const }}>
              You have no shares yet. Deposit DDSC below to start earning.
            </p>
          )}
        </div>
      )}

      {/* ── Mint DDSC ─────────────────────────────────────────────────────────── */}
      {account && (
        <div className="card fade-up-3" style={{ borderColor: 'rgba(244,120,32,0.25)' }}>
          <h2>Get Test DDSC</h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-2)', marginBottom: '0.25rem' }}>
            Mint test DDSC to your wallet.
          </p>
          <label>Amount (DDSC)</label>
          <input type="number" value={mintAmt} onChange={e => setMintAmt(e.target.value)} min="1" />
          <button className="btn btn-secondary" onClick={handleMintDDSC} disabled={minting || !account}>
            {minting ? '⟳ Minting…' : `Mint ${Number(mintAmt).toLocaleString()} DDSC →`}
          </button>
        </div>
      )}

      {/* ── Deposit ────────────────────────────────────────────────────────────── */}
      <div className="card fade-up-4">
        <h2>Deposit DDSC</h2>
        <label>Amount (DDSC)</label>
        <input type="number" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} min="1" />
        <button className="btn btn-primary" onClick={handleDeposit} disabled={!account}>
          Approve &amp; Deposit
        </button>
      </div>

      {/* ── Redeem ─────────────────────────────────────────────────────────────── */}
      {stats && stats.myShares > 0n && (
        <div className="card fade-up-4">
          <h2>Redeem Shares</h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-2)' }}>
            <span className="mono" style={{ color: 'var(--orange)' }}>{fmt2(stats.myShares)}</span> KYRO →{' '}
            <span className="mono" style={{ color: 'var(--orange)' }}>{fmt2(stats.myDDSC)} DDSC</span>
            {yieldPositive && <span style={{ color: 'var(--success)' }}> · +{yieldPct}% yield</span>}
          </p>
          <button className="btn btn-primary" onClick={handleRedeem}>
            Redeem All Shares
          </button>
        </div>
      )}

      {/* Status */}
      {status && (
        <p className={`status ${status.type === 'error' ? 'error' : status.type === 'success' ? 'success' : ''}`}>
          {status.msg}
        </p>
      )}

    </div>
  )
}
