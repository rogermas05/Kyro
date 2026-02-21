'use client'
import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { formatUnits, parseUnits } from 'viem'
import { connectWallet, getPublicClient, getWalletClient } from '../../lib/wallet'
import { ERC20_ABI, ROUTER_ABI, ORACLE_ABI } from '../../lib/abis'

const DEFAULT_MERCHANT = '0x0000000000000000000000000000000000000000'
const ROUTER  = (process.env.NEXT_PUBLIC_ROUTER_ADDRESS  ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ORACLE  = (process.env.NEXT_PUBLIC_ORACLE_ADDRESS  ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const DDSC    = (process.env.NEXT_PUBLIC_DDSC_ADDRESS    ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const MADI    = (process.env.NEXT_PUBLIC_MADI_ADDRESS    ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO    = '0x0000000000000000000000000000000000000000'

interface CheckoutPayload {
  type: 'adi-pay'
  version: '1'
  chainId: number
  router: string
  merchant: string
  fiatAmount: string
  tokenIn: string
  targetToken: string
}

export default function MerchantPage() {
  const [account, setAccount]           = useState<`0x${string}` | null>(null)
  const [amount, setAmount]             = useState('500')
  const [merchant, setMerchant]         = useState(DEFAULT_MERCHANT)
  const [tokenIn, setTokenIn]           = useState(MADI)
  const [targetToken, setTargetToken]   = useState(DDSC)
  const [qrDataUrl, setQrDataUrl]       = useState('')
  const [preview, setPreview]           = useState<bigint | null>(null)
  const [status, setStatus]             = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)

  async function handleConnect() {
    try {
      const acct = await connectWallet()
      setAccount(acct)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  // Regenerate QR whenever config changes
  useEffect(() => {
    async function gen() {
      if (!amount || !merchant) return
      const fiatWei = parseUnits(amount, 18)
      const payload: CheckoutPayload = {
        type: 'adi-pay', version: '1', chainId: 99999,
        router: ROUTER, merchant, fiatAmount: fiatWei.toString(),
        tokenIn, targetToken,
      }
      const url = await QRCode.toDataURL(JSON.stringify(payload), { width: 200, margin: 2 })
      setQrDataUrl(url)
    }
    gen()
  }, [amount, merchant, tokenIn, targetToken])

  // Preview how many tokenIn units will be charged
  async function refreshPreview() {
    if (ORACLE === ZERO || ROUTER === ZERO) return
    try {
      const pub = getPublicClient()
      const fiatWei = parseUnits(amount, 18)
      const tokenAmt = await pub.readContract({
        address: ORACLE, abi: ORACLE_ABI,
        functionName: 'fiatToToken',
        args: [fiatWei, tokenIn as `0x${string}`],
      })
      setPreview(tokenAmt)
    } catch {
      setPreview(null)
    }
  }

  useEffect(() => { refreshPreview() }, [amount, tokenIn])

  async function handleCheckout() {
    if (!account) return setStatus({ msg: 'Connect wallet first.', type: 'error' })
    if (ROUTER === ZERO) return setStatus({ msg: 'NEXT_PUBLIC_ROUTER_ADDRESS not set.', type: 'error' })

    setStatus({ msg: 'Fetching price from oracle…', type: 'info' })
    try {
      const pub = getPublicClient()
      const wallet = getWalletClient(account)
      const fiatWei = parseUnits(amount, 18)

      const tokenAmt = await pub.readContract({
        address: ORACLE, abi: ORACLE_ABI,
        functionName: 'fiatToToken',
        args: [fiatWei, tokenIn as `0x${string}`],
      })

      setStatus({ msg: 'Approving token…', type: 'info' })
      const approveTx = await wallet.writeContract({
        address: tokenIn as `0x${string}`, abi: ERC20_ABI,
        functionName: 'approve', args: [ROUTER, tokenAmt],
      })
      await pub.waitForTransactionReceipt({ hash: approveTx })

      setStatus({ msg: 'Processing checkout…', type: 'info' })
      const checkoutTx = await wallet.writeContract({
        address: ROUTER, abi: ROUTER_ABI,
        functionName: 'checkout',
        args: [merchant as `0x${string}`, fiatWei, tokenIn as `0x${string}`, targetToken as `0x${string}`],
      })
      await pub.waitForTransactionReceipt({ hash: checkoutTx })

      setStatus({ msg: `Payment complete! Tx: ${checkoutTx}`, type: 'success' })
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString('en', { maximumFractionDigits: 4 })

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header fade-up">
        <div className="eyebrow">Merchant Portal</div>
        <h1>KyroPay Checkout</h1>
        <p className="subtitle">
          Stripe-like embedded checkout for the Kyro ecosystem. Customers pay in any supported
          token; merchants receive their preferred token automatically via the on-chain swap router.
        </p>
      </div>

      {/* Wallet */}
      <div className="fade-up-1">
        {account ? (
          <p className="account">{account} (customer)</p>
        ) : (
          <button className="btn btn-secondary" onClick={handleConnect} style={{ marginTop: 0 }}>
            Connect Wallet (as Customer)
          </button>
        )}
      </div>

      {/* Main layout */}
      <div className="grid-2 fade-up-2">

        {/* Config panel */}
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h2>Checkout Configuration</h2>

          <label>Amount (AED)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            min="1"
          />

          <label>Merchant Wallet</label>
          <input
            type="text"
            value={merchant}
            onChange={e => setMerchant(e.target.value)}
            placeholder="0x… merchant address"
          />

          <label>Customer Pays With</label>
          <select value={tokenIn} onChange={e => setTokenIn(e.target.value as `0x${string}`)}>
            <option value={MADI}>mADI — Mock ADI Token</option>
            <option value={DDSC}>DDSC — Dirham Stablecoin</option>
          </select>

          <label>Merchant Receives</label>
          <select value={targetToken} onChange={e => setTargetToken(e.target.value as `0x${string}`)}>
            <option value={DDSC}>DDSC — Dirham Stablecoin</option>
            <option value={MADI}>mADI — Mock ADI Token</option>
          </select>

          {preview !== null && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              background: 'rgba(244,120,32,0.08)',
              border: '1px solid rgba(244,120,32,0.2)',
              borderRadius: 9,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Est. token cost
              </span>
              <span className="mono" style={{ fontSize: '1rem', color: 'var(--orange)', fontWeight: 500 }}>
                {fmt(preview)}
              </span>
            </div>
          )}

          <button className="btn btn-primary" onClick={handleCheckout} disabled={!account}>
            Pay {amount} AED
          </button>

          {status && (
            <p className={`status ${status.type === 'error' ? 'error' : status.type === 'success' ? 'success' : ''}`}>
              {status.msg}
            </p>
          )}
        </div>

        {/* QR panel */}
        <div className="card" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <h2>Mobile Wallet QR</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: '1.5rem', lineHeight: 1.65 }}>
            Scan with a compatible Kyro wallet to pre-fill and submit the checkout transaction on mobile.
          </p>

          {qrDataUrl ? (
            <div className="qr-wrap" style={{ margin: '0 auto' }}>
              <img src={qrDataUrl} alt={`Pay ${amount} AED QR`} />
              <p>Scan to pay {amount} AED</p>
            </div>
          ) : (
            <div style={{
              width: 200, height: 200,
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 12,
              margin: '0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--muted)', fontSize: '0.8rem',
              border: '1px solid var(--border-sub)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              Generating…
            </div>
          )}

          <p style={{ marginTop: '1.25rem', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.8 }}>
            Payload: chainId · router<br />merchant · fiatAmount · tokenIn · targetToken
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="card fade-up-3">
        <h2>How It Works</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.5rem' }}>
          {[
            { n: '1', text: 'Merchant sets price in AED — no crypto knowledge required.' },
            { n: '2', text: 'Customer scans QR or clicks Pay — wallet connects and pre-fills the transaction.' },
            { n: '3', text: 'KyroPayRouter queries PriceOracle to determine the exact token cost.' },
            { n: '4', text: 'If tokens differ, MockSwapRouter converts at oracle rates automatically.' },
            { n: '5', text: "Merchant receives their preferred token; optional protocol fee deducted." },
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: 'rgba(244,120,32,0.15)',
                border: '1px solid rgba(244,120,32,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.68rem', fontWeight: 700, color: 'var(--orange)', flexShrink: 0,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {step.n}
              </div>
              <p style={{ fontSize: '0.87rem', color: 'var(--text-2)', lineHeight: 1.65, paddingTop: '0.2rem' }}>
                {step.text}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
