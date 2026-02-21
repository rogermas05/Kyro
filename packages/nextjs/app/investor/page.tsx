'use client'
import { useState, useEffect } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { getPublicClient, getWalletClient } from '../../lib/wallet'
import { VAULT_ABI, ERC20_ABI, ORCHESTRATOR_ABI } from '../../lib/abis'
import { useWallet } from '../context/WalletContext'

const VAULT         = (process.env.NEXT_PUBLIC_VAULT_ADDRESS         ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const DDSC          = (process.env.NEXT_PUBLIC_DDSC_ADDRESS          ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ORCHESTRATOR  = (process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS  ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO          = '0x0000000000000000000000000000000000000000'

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

function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  const W = 96, H = 32, pad = 3
  const minY = Math.min(...points)
  const maxY = Math.max(...points)
  const range = maxY - minY || 1
  const toSvg = (v: number, i: number) => {
    const x = pad + (i / (points.length - 1)) * (W - 2 * pad)
    const y = H - pad - ((v - minY) / range) * (H - 2 * pad)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  const polyline = points.map(toSvg).join(' ')
  const color = positive ? '#3dcf8e' : 'rgba(255,255,255,0.2)'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      {/* End dot */}
      {(() => {
        const last = points[points.length - 1]
        const [x, y] = toSvg(last, points.length - 1).split(',').map(Number)
        return <circle cx={x} cy={y} r="2.5" fill={color} />
      })()}
    </svg>
  )
}

export default function InvestorPage() {
  const { account } = useWallet()
  const [stats,       setStats]      = useState<Stats | null>(null)
  const [sparkPoints, setSparkPoints] = useState<number[]>([])
  const [depositAmt,  setDepositAmt] = useState('1000')
  const [mintAmt,     setMintAmt]    = useState('10000')
  const [status,      setStatus]     = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [minting,     setMinting]    = useState(false)

  async function loadStats(acct?: `0x${string}`) {
    if (VAULT === ZERO) return
    try {
      const pub = getPublicClient()
      const [totalAssets, vaultCash, sharePrice] = await Promise.all([
        pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' }),
        pub.readContract({ address: DDSC,  abi: ERC20_ABI, functionName: 'balanceOf', args: [VAULT] }),
        pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets', args: [ONE_SHARE] }),
      ])
      let myShares = 0n, myDDSC = 0n, ddscBalance = 0n
      if (acct) {
        ;[myShares, ddscBalance] = await Promise.all([
          pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'balanceOf', args: [acct] }),
          pub.readContract({ address: DDSC,  abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] }),
        ])
        myDDSC = myShares > 0n
          ? await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets', args: [myShares] })
          : 0n
      }
      setStats({ totalAssets, vaultCash, sharePrice, myShares, myDDSC, ddscBalance })

      // Build sparkline: interpolate price from 1.0 → current across settled events
      if (ORCHESTRATOR !== ZERO) {
        try {
          const latest = await pub.getBlockNumber()
          const fromBlock = latest > 10_000n ? latest - 10_000n : 0n
          const settled = await pub.getContractEvents({
            address: ORCHESTRATOR, abi: ORCHESTRATOR_ABI,
            eventName: 'InvoiceSettled', fromBlock, toBlock: latest,
          })
          const n = settled.length
          const currentPrice = Number(formatUnits(sharePrice as bigint, 18))
          // Produce n+2 points: start at 1.0, rise after each settlement, end at current
          const points: number[] = [1.0]
          for (let i = 1; i <= n; i++) {
            points.push(1.0 + ((currentPrice - 1.0) * i) / n)
          }
          if (currentPrice !== points[points.length - 1]) points.push(currentPrice)
          setSparkPoints(points)
        } catch { /* skip */ }
      }
    } catch { /* ignore if contracts not yet deployed */ }
  }

  // Load public vault stats on mount (no wallet needed)
  useEffect(() => { loadStats() }, [])

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

  // ── SVG Donut Chart ────────────────────────────────────────────────────────
  const r = 108, cx = 128, cy = 128
  const circ = 2 * Math.PI * r
  const deployedLen = (utilPct / 100) * circ
  const idleLen = circ - deployedLen

  return (
    <div className="page">

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div className="page-header fade-up" style={{ marginBottom: '1.5rem' }}>
        <div className="eyebrow">Investor Portal</div>
        <h1>Kyro Vault</h1>
      </div>

      {/* Contracts not deployed warning */}
      {VAULT === ZERO && (
        <div className="card fade-up-1" style={{ borderColor: 'rgba(244,120,32,0.3)', marginTop: 0, marginBottom: '1.5rem' }}>
          <p style={{ fontSize: '0.88rem', color: 'var(--orange)', margin: 0 }}>
            ⚠ Set NEXT_PUBLIC_VAULT_ADDRESS and NEXT_PUBLIC_DDSC_ADDRESS in .env.local after running deploy scripts.
          </p>
        </div>
      )}

      {/* ── Your Position Hero ─────────────────────────────────────────────────── */}
      <div className="card fade-up-2" style={{
        marginTop: 0,
        background: account && stats && stats.myShares > 0n
          ? 'linear-gradient(135deg, rgba(0,53,95,0.5) 0%, rgba(0,30,50,0.6) 100%)'
          : 'var(--surface)',
        borderColor: account && stats && stats.myShares > 0n && yieldPositive
          ? 'rgba(61,207,142,0.2)' : 'var(--border-sub)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0 }}>Your Position</h2>
          {stats && stats.myShares > 0n && yieldPositive && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              fontSize: '0.78rem', fontWeight: 700, color: 'var(--success)',
              background: 'rgba(61,207,142,0.1)', border: '1px solid rgba(61,207,142,0.3)',
              borderRadius: 6, padding: '0.25rem 0.65rem',
            }}>
              <span className="live-dot" style={{ width: 6, height: 6 }} />
              +{yieldPct}% yield
            </span>
          )}
        </div>

        {!account ? (
          /* Not connected */
          <div style={{ textAlign: 'center' as const, padding: '1.5rem 0' }}>
            <div style={{ fontSize: '0.88rem', color: 'var(--muted)' }}>
              Connect your wallet to see your position and deposit DDSC.
            </div>
          </div>
        ) : !stats ? (
          <div style={{ textAlign: 'center' as const, padding: '1rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>Loading…</div>
        ) : stats.myShares === 0n ? (
          /* Connected but no position */
          <div>
            <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.12em', marginBottom: '0.3rem' }}>Wallet Balance</div>
                <div style={{ fontSize: '1.7rem', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--text)' }}>
                  {fmt2(stats.ddscBalance)} <span style={{ fontSize: '0.85rem', color: 'var(--muted)', fontWeight: 400 }}>DDSC</span>
                </div>
              </div>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: 0 }}>
              No shares yet — deposit DDSC below to start earning yield from invoice settlements.
            </p>
          </div>
        ) : (
          /* Has position */
          <>
            {/* Hero number */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.12em', marginBottom: '0.4rem' }}>Total Value</div>
              <div style={{
                fontSize: '2.4rem', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--text)', lineHeight: 1,
                ...(yieldPositive ? { textShadow: '0 0 32px rgba(61,207,142,0.2)' } : {}),
              }}>
                {fmt2(stats.myDDSC)}
                <span style={{ fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 400, marginLeft: '0.4rem' }}>DDSC</span>
              </div>
            </div>
            <div className="stat-grid" style={{ marginBottom: 0 }}>
              <div className="stat">
                <div className="stat-label">Shares Held</div>
                <div className="stat-value" style={{ fontSize: '1.25rem' }}>{fmt2(stats.myShares)}</div>
                <div className="stat-unit">KYRO</div>
              </div>
              <div className="stat">
                <div className="stat-label">Yield Earned</div>
                <div className="stat-value" style={{ fontSize: '1.25rem', color: yieldPositive ? 'var(--success)' : 'var(--muted)' }}>
                  {fmt2(stats.myDDSC > stats.myShares ? stats.myDDSC - stats.myShares : 0n)}
                </div>
                <div className="stat-unit">DDSC</div>
              </div>
              <div className="stat">
                <div className="stat-label">Wallet Balance</div>
                <div className="stat-value" style={{ fontSize: '1.25rem' }}>{fmt2(stats.ddscBalance)}</div>
                <div className="stat-unit">DDSC</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Two-column: Vault | Actions ─────────────────────────────────────────── */}
      <div className="two-col" style={{ marginTop: '1.5rem' }}>

        {/* ── Left: Vault Performance + Donut ──────────────────────────────────── */}
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ margin: 0 }}>Vault</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => loadStats(account ?? undefined)} style={{ marginTop: 0 }}>↻</button>
          </div>

          {/* Share price row */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '1.1rem 1.25rem', borderRadius: 12,
            background: yieldPositive ? 'rgba(61,207,142,0.06)' : 'rgba(0,0,0,0.2)',
            border: `1px solid ${yieldPositive ? 'rgba(61,207,142,0.2)' : 'var(--border-sub)'}`,
            marginBottom: '1.75rem',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
                {yieldPositive && <span className="live-dot" />}
                Share Price
              </div>
              <div style={{
                fontSize: '2rem', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--text)',
                ...(yieldPositive ? { textShadow: '0 0 20px rgba(61,207,142,0.3)' } : {}),
              }}>
                {sharePriceNum.toFixed(4)}
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)', marginLeft: '0.4rem' }}>DDSC/KYRO</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '0.5rem' }}>
              <div style={{
                padding: '0.35rem 0.75rem', borderRadius: 6,
                fontSize: '0.82rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                color: yieldPositive ? 'var(--success)' : 'var(--muted)',
                background: yieldPositive ? 'rgba(61,207,142,0.12)' : 'rgba(0,0,0,0.2)',
                border: `1px solid ${yieldPositive ? 'rgba(61,207,142,0.35)' : 'var(--border-sub)'}`,
              }}>
                {yieldPositive ? '+' : ''}{yieldPct}%
              </div>
              {sparkPoints.length >= 2 && (
                <Sparkline points={sparkPoints} positive={yieldPositive} />
              )}
            </div>
          </div>

          {/* Donut chart — centered, full-card-width */}
          {stats && stats.totalAssets > 0n ? (
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '1.75rem' }}>
              {/* SVG Donut — centered */}
              <svg width="256" height="256" viewBox="0 0 256 256">
                {/* Track */}
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={18} />
                {/* Deployed segment (blue) */}
                <circle
                  cx={cx} cy={cy} r={r} fill="none"
                  stroke="#7fbadc" strokeWidth={18}
                  strokeDasharray={`${deployedLen} ${circ - deployedLen}`}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${cx} ${cy})`}
                  style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.22,1,0.36,1)' }}
                />
                {/* Idle segment (orange) */}
                {idleLen > 2 && (
                  <circle
                    cx={cx} cy={cy} r={r} fill="none"
                    stroke="rgba(244,120,32,0.55)" strokeWidth={18}
                    strokeDasharray={`${idleLen} ${circ - idleLen}`}
                    strokeDashoffset={-deployedLen}
                    strokeLinecap="round"
                    transform={`rotate(-90 ${cx} ${cy})`}
                    style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.22,1,0.36,1)' }}
                  />
                )}
                {/* Center label */}
                <text x={cx} y={cy - 10} textAnchor="middle" fill="#ffffff" fontSize="30" fontWeight="600" fontFamily="JetBrains Mono, monospace">{utilPct}%</text>
                <text x={cx} y={cy + 16} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="11" fontFamily="JetBrains Mono, monospace" letterSpacing="1.5">DEPLOYED</text>
              </svg>

              {/* Legend — 3-column row below chart */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr 1px 1fr', gap: '0', width: '100%', borderTop: '1px solid var(--border-sub)', paddingTop: '1.5rem' }}>
                {/* Deployed */}
                <div style={{ textAlign: 'center' as const }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: '#7fbadc', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.68rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>Deployed</span>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 600, color: '#7fbadc' }}>
                    {fmt0(deployed)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.15rem' }}>DDSC</div>
                </div>
                {/* Divider */}
                <div style={{ background: 'var(--border-sub)' }} />
                {/* Idle */}
                <div style={{ textAlign: 'center' as const }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(244,120,32,0.55)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.68rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>Idle Cash</span>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 600, color: 'var(--orange)' }}>
                    {fmt0(stats.vaultCash)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.15rem' }}>DDSC</div>
                </div>
                {/* Divider */}
                <div style={{ background: 'var(--border-sub)' }} />
                {/* Total */}
                <div style={{ textAlign: 'center' as const }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: '0.35rem' }}>Total Assets</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>
                    {fmt0(stats.totalAssets)}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '0.15rem' }}>DDSC</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center' as const, padding: '3rem 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              {stats ? 'Vault is empty — deposit DDSC to start.' : 'Loading vault data…'}
            </div>
          )}
        </div>

        {/* ── Right: Actions column ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '1rem' }}>

          {/* Deposit */}
          <div className="card" style={{ margin: 0 }}>
            <h2>Deposit DDSC</h2>
            <label>Amount</label>
            <input type="number" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} min="1" placeholder="1000" />
            <button className="btn btn-primary" onClick={handleDeposit} disabled={!account}>
              Approve &amp; Deposit
            </button>
            {!account && (
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.5rem', textAlign: 'center' as const }}>Connect wallet to deposit</p>
            )}
          </div>

          {/* Redeem — only if user has shares */}
          {stats && stats.myShares > 0n && (
            <div className="card" style={{ margin: 0, borderColor: yieldPositive ? 'rgba(61,207,142,0.2)' : 'var(--border-sub)' }}>
              <h2>Redeem Shares</h2>
              <div style={{ padding: '0.85rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px solid var(--border-sub)', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>You redeem</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem', color: 'var(--orange)' }}>{fmt2(stats.myShares)} KYRO</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>You receive</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.82rem', color: yieldPositive ? 'var(--success)' : 'var(--text)' }}>
                    {fmt2(stats.myDDSC)} DDSC{yieldPositive && <span style={{ fontSize: '0.7rem', marginLeft: '0.35rem' }}>+{yieldPct}%</span>}
                  </span>
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleRedeem} style={{ background: yieldPositive ? 'var(--success)' : undefined }}>
                Redeem All Shares
              </button>
            </div>
          )}

          {/* Mint DDSC — de-emphasized, local dev only */}
          {account && (
            <div style={{
              padding: '1rem 1.1rem',
              background: 'rgba(0,0,0,0.15)',
              border: '1px solid var(--border-sub)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
                Get Test DDSC
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input type="number" value={mintAmt} onChange={e => setMintAmt(e.target.value)} min="1" style={{ marginTop: 0 }} />
                </div>
                <button className="btn btn-secondary" onClick={handleMintDDSC} disabled={minting} style={{ marginTop: 0, whiteSpace: 'nowrap' as const }}>
                  {minting ? '⟳' : 'Mint →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      {status && (
        <p className={`status ${status.type === 'error' ? 'error' : status.type === 'success' ? 'success' : ''}`} style={{ marginTop: '1.5rem' }}>
          {status.msg}
        </p>
      )}

    </div>
  )
}
