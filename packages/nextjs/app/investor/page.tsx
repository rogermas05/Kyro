'use client'
import { useState, useEffect } from 'react'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { connectWallet, getPublicClient, getWalletClient } from '../../lib/wallet'
import { VAULT_ABI, ERC20_ABI } from '../../lib/abis'

const VAULT = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const DDSC  = (process.env.NEXT_PUBLIC_DDSC_ADDRESS  ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO  = '0x0000000000000000000000000000000000000000'

interface Stats {
  totalAssets: bigint
  myShares: bigint
  myDDSC: bigint
  ddscBalance: bigint
}

export default function InvestorPage() {
  const [account, setAccount]       = useState<`0x${string}` | null>(null)
  const [stats, setStats]           = useState<Stats | null>(null)
  const [depositAmt, setDepositAmt] = useState('1000')
  const [status, setStatus]         = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)

  async function handleConnect() {
    try {
      const acct = await connectWallet()
      setAccount(acct)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  async function loadStats(acct: `0x${string}`) {
    if (VAULT === ZERO) return
    try {
      const pub = getPublicClient()
      const [totalAssets, myShares, ddscBalance] = await Promise.all([
        pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' }),
        pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'balanceOf', args: [acct] }),
        pub.readContract({ address: DDSC,  abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] }),
      ])
      const myDDSC = myShares > 0n
        ? await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets', args: [myShares] })
        : 0n
      setStats({ totalAssets, myShares, myDDSC, ddscBalance })
    } catch {
      // silently ignore if contracts not deployed
    }
  }

  useEffect(() => {
    if (account) loadStats(account)
  }, [account])

  async function handleDeposit() {
    if (!account) return setStatus({ msg: 'Connect wallet first.', type: 'error' })
    if (VAULT === ZERO) return setStatus({ msg: 'NEXT_PUBLIC_VAULT_ADDRESS not set.', type: 'error' })

    setStatus({ msg: 'Approving DDSC…', type: 'info' })
    try {
      const amount = parseUnits(depositAmt, 18)
      const wallet = getWalletClient(account)
      const pub    = getPublicClient()

      const approveTx = await wallet.writeContract({
        address: DDSC, abi: ERC20_ABI, functionName: 'approve', args: [VAULT, amount],
      })
      await pub.waitForTransactionReceipt({ hash: approveTx })

      setStatus({ msg: 'Depositing…', type: 'info' })
      const depositTx = await wallet.writeContract({
        address: VAULT, abi: VAULT_ABI, functionName: 'deposit', args: [amount, account],
      })
      await pub.waitForTransactionReceipt({ hash: depositTx })

      setStatus({ msg: `Deposit complete! Tx: ${depositTx}`, type: 'success' })
      await loadStats(account)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

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
      setStatus({ msg: `Redemption complete! Tx: ${hash}`, type: 'success' })
      await loadStats(account)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString('en', { maximumFractionDigits: 2 })

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header fade-up">
        <div className="eyebrow">Investor Portal</div>
        <h1>Kyro Vault</h1>
        <p className="subtitle">
          Deposit DDSC into the Kyro ERC-4626 Vault. Earn yield as SME invoices are
          settled on-chain. Senior tranche priority provides institutional-grade protection.
        </p>
      </div>

      {/* Wallet */}
      <div className="fade-up-1">
        {account ? (
          <p className="account">{account}</p>
        ) : (
          <button className="btn btn-secondary" onClick={handleConnect} style={{ marginTop: 0 }}>
            Connect Wallet
          </button>
        )}
      </div>

      {/* Contract not deployed warning */}
      {VAULT === ZERO && (
        <div className="card fade-up-2" style={{ borderColor: 'rgba(244,120,32,0.3)' }}>
          <p style={{ fontSize: '0.88rem', color: 'var(--orange)' }}>
            ⚠ Contracts not deployed yet. Set NEXT_PUBLIC_VAULT_ADDRESS and NEXT_PUBLIC_DDSC_ADDRESS
            in .env.local after running the deploy scripts.
          </p>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="card fade-up-2">
          <h2>Vault Statistics</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Total Assets</div>
              <div className="stat-value">{fmt(stats.totalAssets)}</div>
              <div className="stat-unit">DDSC</div>
            </div>
            <div className="stat">
              <div className="stat-label">Your Shares</div>
              <div className="stat-value">{fmt(stats.myShares)}</div>
              <div className="stat-unit">KYRO</div>
            </div>
            <div className="stat">
              <div className="stat-label">Your Value</div>
              <div className="stat-value">{fmt(stats.myDDSC)}</div>
              <div className="stat-unit">DDSC</div>
            </div>
            <div className="stat">
              <div className="stat-label">DDSC Balance</div>
              <div className="stat-value">{fmt(stats.ddscBalance)}</div>
              <div className="stat-unit">DDSC</div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit */}
      <div className="card fade-up-3">
        <h2>Deposit DDSC</h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-2)', marginBottom: '0.25rem' }}>
          Approve and deposit DDSC to receive vault shares. Shares accrue yield as invoices settle.
        </p>
        <label>Amount (DDSC)</label>
        <input
          type="number"
          value={depositAmt}
          onChange={e => setDepositAmt(e.target.value)}
          min="1"
        />
        <button className="btn btn-primary" onClick={handleDeposit} disabled={!account}>
          Approve &amp; Deposit
        </button>
      </div>

      {/* Redeem */}
      {stats && stats.myShares > 0n && (
        <div className="card fade-up-4">
          <h2>Redeem Shares</h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-2)' }}>
            Redeem all{' '}
            <span className="mono" style={{ color: 'var(--orange)' }}>{fmt(stats.myShares)}</span>{' '}
            shares for approximately{' '}
            <span className="mono" style={{ color: 'var(--orange)' }}>{fmt(stats.myDDSC)} DDSC</span>{' '}
            — principal plus accrued yield.
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
