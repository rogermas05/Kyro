'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { keccak256, encodePacked, parseUnits, formatUnits } from 'viem'
import {
  connectWallet, connectWithKey, disconnectWallet,
  getPublicClient, getWalletClient, ANVIL_ACCOUNTS,
} from '../../lib/wallet'
import { ORCHESTRATOR_ABI, ERC20_ABI, IDENTITY_REGISTRY_ABI } from '../../lib/abis'
import { adi } from '../../lib/chain'

// ── Constants ──────────────────────────────────────────────────────────────────

const ORCHESTRATOR   = (process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS        ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const DDSC_ADDR      = (process.env.NEXT_PUBLIC_DDSC_ADDRESS                ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const JUNIOR_ADDR    = (process.env.NEXT_PUBLIC_JUNIOR_TOKEN_ADDRESS        ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const IDENTITY_REG   = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS   ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO           = '0x0000000000000000000000000000000000000000' as `0x${string}`
const EXPLORER_URL   = adi.blockExplorers?.default?.url ?? ''

// ── Types ──────────────────────────────────────────────────────────────────────

interface Attestation {
  invoiceId:     `0x${string}`
  proof:         `0x${string}`
  faceWei:       bigint
  dueSecs:       bigint
  docHash:       `0x${string}`
  buyerWallet:   `0x${string}`
  invoiceNumber: string
  faceValue:     string
  dueDate:       string
  buyerName:     string
  fileName:      string
}

interface InvoiceItem {
  invoiceId:    `0x${string}`
  faceValue:    bigint
  seniorAmount: bigint
  juniorAmount: bigint
  state:        'PENDING' | 'ACTIVE' | 'SETTLED' | 'DEFAULTED'
  dueSecs:      bigint   // 0n when unknown
  blockNumber:  bigint
}

interface StoredInvoice {
  invoiceId:     string
  invoiceNumber: string
  faceValue:     string
  dueDate:       string  // ISO date string e.g. "2025-06-01"
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function hashFile(file: File): Promise<`0x${string}`> {
  const buf     = await file.arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  const bytes   = Array.from(new Uint8Array(hashBuf))
  return ('0x' + bytes.map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

function hashMetadata(invoiceNumber: string, faceValue: string, dueDate: string): `0x${string}` {
  return keccak256(encodePacked(['string', 'string', 'string'], [invoiceNumber, faceValue, dueDate]))
}

function fmtAddr(addr: string): string {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function fmtAED(wei: bigint): string {
  return Number(formatUnits(wei, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' AED'
}

function fmtDDSC(wei: bigint): string {
  return Number(formatUnits(wei, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function daysLeft(unix: bigint): number {
  return Math.ceil((Number(unix) - Date.now() / 1000) / 86400)
}

function stateColor(state: InvoiceItem['state']): string {
  switch (state) {
    case 'PENDING':   return 'var(--orange)'
    case 'ACTIVE':    return '#7fbadc'
    case 'SETTLED':   return 'var(--success)'
    case 'DEFAULTED': return '#e05c5c'
  }
}

function stateLabel(state: InvoiceItem['state']): string {
  switch (state) {
    case 'PENDING':   return 'Pending'
    case 'ACTIVE':    return 'Active (Funded)'
    case 'SETTLED':   return 'Settled'
    case 'DEFAULTED': return 'Defaulted'
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SMEPage() {
  // Core state
  const [account, setAccount]           = useState<`0x${string}` | null>(null)
  const [step, setStep]                 = useState<'form' | 'attesting' | 'review' | 'minting' | 'done'>('form')
  const [status, setStatus]             = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [attestation, setAttestation]   = useState<Attestation | null>(null)
  const [mintedTxHash, setMintedTxHash] = useState<`0x${string}` | null>(null)

  // Form state
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [faceValue, setFaceValue]         = useState('10000')
  const [dueDate, setDueDate]             = useState('')
  const [buyerName, setBuyerName]         = useState('')
  const [buyerWallet, setBuyerWallet]     = useState('')
  const [file, setFile]                   = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Duplicate-invoice warning
  const [dupWarn, setDupWarn] = useState<string | null>(null)

  // Dashboard state
  const [ddscBalance,      setDdscBalance]      = useState<bigint | null>(null)
  const [juniorBalance,    setJuniorBalance]     = useState<bigint | null>(null)
  const [kycVerified,      setKycVerified]       = useState<boolean | null>(null)
  const [myInvoices,       setMyInvoices]        = useState<InvoiceItem[]>([])
  const [dashboardLoading, setDashboardLoading]  = useState(false)
  // Which invoice is currently being settled/defaulted
  const [invAction,        setInvAction]         = useState<string | null>(null)

  // ── Effects ──────────────────────────────────────────────────────────────────

  // Feature 12: Restore wallet connection on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (process.env.NEXT_PUBLIC_USE_LOCAL === 'true') {
      try {
        const savedKey = localStorage.getItem('sme_active_key') as `0x${string}` | null
        if (savedKey) {
          const addr = connectWithKey(savedKey)
          setAccount(addr)
        }
      } catch { /* ignore */ }
    } else {
      // Silent reconnect: if already authorized, MetaMask returns accounts without popup
      const win = window as Window & { ethereum?: { request: (a: { method: string }) => Promise<string[]> } }
      win.ethereum?.request({ method: 'eth_accounts' })
        .then(accounts => {
          if (accounts.length > 0) connectWallet().then(setAccount).catch(() => {})
        })
        .catch(() => {})
    }
  }, [])

  // Feature 16: Load form draft from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem('sme_form_draft')
      if (!raw) return
      const d = JSON.parse(raw) as Partial<{ invoiceNumber: string; faceValue: string; dueDate: string; buyerName: string; buyerWallet: string }>
      if (d.invoiceNumber) setInvoiceNumber(d.invoiceNumber)
      if (d.faceValue)     setFaceValue(d.faceValue)
      if (d.dueDate)       setDueDate(d.dueDate)
      if (d.buyerName)     setBuyerName(d.buyerName)
      if (d.buyerWallet)   setBuyerWallet(d.buyerWallet)
    } catch { /* ignore */ }
  }, [])

  // Feature 16: Save form draft to localStorage whenever fields change
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem('sme_form_draft', JSON.stringify({ invoiceNumber, faceValue, dueDate, buyerName, buyerWallet }))
    } catch { /* ignore */ }
  }, [invoiceNumber, faceValue, dueDate, buyerName, buyerWallet])

  // Features 7,8,9,11: Load dashboard data whenever account changes
  const loadDashboard = useCallback(async (acct: `0x${string}`) => {
    setDashboardLoading(true)
    const pub = getPublicClient()
    try {
      // Feature 7: DDSC balance
      if (DDSC_ADDR !== ZERO) {
        const bal = await pub.readContract({ address: DDSC_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] })
        setDdscBalance(bal)
      }

      // Feature 8: Junior (J-DEBT) balance
      if (JUNIOR_ADDR !== ZERO) {
        const bal = await pub.readContract({ address: JUNIOR_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] })
        setJuniorBalance(bal)
      }

      // Feature 9: KYC status
      if (IDENTITY_REG !== ZERO) {
        const verified = await pub.readContract({ address: IDENTITY_REG, abi: IDENTITY_REGISTRY_ABI, functionName: 'isVerified', args: [acct] })
        setKycVerified(verified)
      }

      // Features 3,4,5,6: My Invoices
      if (ORCHESTRATOR !== ZERO) {
        const mintedEvts = await pub.getContractEvents({
          address:   ORCHESTRATOR,
          abi:       ORCHESTRATOR_ABI,
          eventName: 'InvoiceMinted',
          args:      { sme: acct },
          fromBlock: 0n,
          toBlock:   'latest',
        })

        if (mintedEvts.length > 0) {
          // Get all settled / defaulted events to cross-reference
          const [settledEvts, defaultedEvts] = await Promise.all([
            pub.getContractEvents({ address: ORCHESTRATOR, abi: ORCHESTRATOR_ABI, eventName: 'InvoiceSettled',  fromBlock: 0n, toBlock: 'latest' }),
            pub.getContractEvents({ address: ORCHESTRATOR, abi: ORCHESTRATOR_ABI, eventName: 'InvoiceDefaulted', fromBlock: 0n, toBlock: 'latest' }),
          ])

          const settledIds   = new Set(settledEvts.map(e => e.args.invoiceId as string))
          const defaultedIds = new Set(defaultedEvts.map(e => e.args.invoiceId as string))

          const items: InvoiceItem[] = []
          for (const evt of mintedEvts) {
            const invoiceId = evt.args.invoiceId!
            let invoiceState: InvoiceItem['state'] = 'PENDING'

            try {
              // Feature 4: Read current on-chain state
              const rec = await pub.readContract({
                address:      ORCHESTRATOR,
                abi:          ORCHESTRATOR_ABI,
                functionName: 'invoices',
                args:         [invoiceId],
              })
              // rec is a tuple: [sme, seniorAmount, juniorAmount, seniorPurchased, settled]
              const seniorPurchased = rec[3]
              const settled         = rec[4]
              if (settled) {
                invoiceState = defaultedIds.has(invoiceId) ? 'DEFAULTED' : 'SETTLED'
              } else if (seniorPurchased) {
                invoiceState = 'ACTIVE'
              }
            } catch { /* leave as PENDING */ }

            // Feature 6: Due date from localStorage (saved on mint)
            let dueSecs = 0n
            try {
              const stored = localStorage.getItem(`sme_inv_${invoiceId}`)
              if (stored) {
                const parsed = JSON.parse(stored) as StoredInvoice
                if (parsed.dueDate) {
                  dueSecs = BigInt(Math.floor(new Date(parsed.dueDate).getTime() / 1000))
                }
              }
            } catch { /* no local record */ }

            items.push({
              invoiceId,
              faceValue:    evt.args.faceValue    ?? 0n,
              seniorAmount: evt.args.seniorAmount  ?? 0n,
              juniorAmount: evt.args.juniorAmount  ?? 0n,
              state:        invoiceState,
              dueSecs,
              blockNumber:  evt.blockNumber ?? 0n,
            })
          }

          setMyInvoices(items.sort((a, b) => Number(b.blockNumber - a.blockNumber)))
        } else {
          setMyInvoices([])
        }
      }
    } catch (e) {
      console.error('[SME] Dashboard load error:', e)
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  useEffect(() => {
    if (account) {
      loadDashboard(account)
    } else {
      setDdscBalance(null)
      setJuniorBalance(null)
      setKycVerified(null)
      setMyInvoices([])
    }
  }, [account, loadDashboard])

  // ── Wallet handlers ───────────────────────────────────────────────────────────

  async function handleConnect() {
    try {
      const acct = await connectWallet()
      setAccount(acct)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  // Feature 11: local wallet connect — also persist key in localStorage
  function handleLocalConnect(key: `0x${string}`) {
    const addr = connectWithKey(key)
    try { localStorage.setItem('sme_active_key', key) } catch { /* ignore */ }
    setAccount(addr)
  }

  // Feature 11: disconnect
  function handleDisconnect() {
    disconnectWallet()
    try { localStorage.removeItem('sme_active_key') } catch { /* ignore */ }
    setAccount(null)
    setStep('form')
    setAttestation(null)
    setStatus(null)
    setMintedTxHash(null)
    setDupWarn(null)
  }

  // ── Form handlers ─────────────────────────────────────────────────────────────

  // Feature 17: duplicate invoice detection
  async function handleAttest() {
    if (!account)                               return setStatus({ msg: 'Connect your wallet first.', type: 'error' })
    if (!invoiceNumber.trim())                  return setStatus({ msg: 'Invoice number is required.', type: 'error' })
    if (!faceValue || Number(faceValue) <= 0)   return setStatus({ msg: 'Invoice amount must be greater than 0.', type: 'error' })
    if (!dueDate)                               return setStatus({ msg: 'Due date is required.', type: 'error' })
    if (ORCHESTRATOR === ZERO)                  return setStatus({ msg: 'Contracts not deployed — set NEXT_PUBLIC_ORCHESTRATOR_ADDRESS in .env.local.', type: 'error' })

    // Check for duplicate invoice number from this wallet
    try {
      const dupKey  = `sme_submitted_${account.toLowerCase()}`
      const nums    = JSON.parse(localStorage.getItem(dupKey) ?? '[]') as string[]
      const trimmed = invoiceNumber.trim()
      if (nums.includes(trimmed)) {
        setDupWarn(`Invoice "${trimmed}" was already submitted from this wallet. Re-submitting the same invoice number will fail on-chain.`)
        return
      }
    } catch { /* ignore */ }

    await doAttest()
  }

  async function doAttest() {
    setDupWarn(null)
    setStep('attesting')
    setStatus({ msg: 'Registering wallet with KYC registry…', type: 'info' })

    try {
      await fetch('/api/register-sme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: account }),
      })

      setStatus({ msg: 'Requesting oracle attestation…', type: 'info' })

      const faceWei = parseUnits(faceValue, 18)
      const dueSecs = BigInt(Math.floor(new Date(dueDate).getTime() / 1000))
      const docHash = file ? await hashFile(file) : hashMetadata(invoiceNumber, faceValue, dueDate)
      const buyer   = (buyerWallet.startsWith('0x') ? buyerWallet : ZERO) as `0x${string}`

      const res = await fetch('/api/attest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: account,
          invoiceNumber: invoiceNumber.trim(),
          faceValue:     faceWei.toString(),
          dueSecs:       dueSecs.toString(),
          docHash,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Oracle service error' }))
        throw new Error(err.error ?? 'Oracle service error')
      }

      const { invoiceId, proof } = await res.json() as { invoiceId: `0x${string}`; proof: `0x${string}` }

      setAttestation({
        invoiceId, proof, faceWei, dueSecs, docHash,
        buyerWallet:   buyer,
        invoiceNumber: invoiceNumber.trim(),
        faceValue, dueDate,
        buyerName:     buyerName.trim() || 'Not specified',
        fileName:      file?.name ?? '',
      })

      setStep('review')
      setStatus(null)
    } catch (e: unknown) {
      setStep('form')
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  async function handleMint() {
    if (!account || !attestation) return
    setStep('minting')
    setStatus({ msg: 'Waiting for wallet confirmation…', type: 'info' })

    try {
      const walletClient = getWalletClient(account)
      const pubClient    = getPublicClient()

      const hash = await walletClient.writeContract({
        address:      ORCHESTRATOR,
        abi:          ORCHESTRATOR_ABI,
        functionName: 'mintInvoice',
        args: [
          attestation.invoiceId,
          attestation.faceWei,
          attestation.dueSecs,
          attestation.docHash,
          attestation.buyerWallet,
          attestation.proof,
        ],
      })

      setStatus({ msg: 'Transaction submitted, confirming…', type: 'info' })
      const receipt = await pubClient.waitForTransactionReceipt({ hash, timeout: 60_000 })

      if (receipt.status === 'reverted') {
        setStep('review')
        setStatus({ msg: 'Transaction reverted — wallet may not be KYC-registered.', type: 'error' })
        return
      }

      // Feature 14: Persist invoice details to localStorage for dashboard
      try {
        const stored: StoredInvoice = {
          invoiceId:     attestation.invoiceId,
          invoiceNumber: attestation.invoiceNumber,
          faceValue:     attestation.faceValue,
          dueDate:       attestation.dueDate,
        }
        localStorage.setItem(`sme_inv_${attestation.invoiceId}`, JSON.stringify(stored))

        // Feature 17: Track submitted invoice numbers per wallet (duplicate detection)
        const dupKey = `sme_submitted_${account.toLowerCase()}`
        const nums   = JSON.parse(localStorage.getItem(dupKey) ?? '[]') as string[]
        if (!nums.includes(attestation.invoiceNumber)) {
          nums.push(attestation.invoiceNumber)
          localStorage.setItem(dupKey, JSON.stringify(nums))
        }

        // Clear the form draft since this invoice is now submitted
        localStorage.removeItem('sme_form_draft')
      } catch { /* ignore */ }

      setMintedTxHash(hash)
      setStep('done')
      setStatus(null)

      // Reload dashboard to reflect the new invoice
      loadDashboard(account)

      // Auto-fund: vault protocol automatically purchases the senior tranche.
      // Fire-and-forget — if the vault has liquidity it succeeds silently;
      // if not, the invoice stays PENDING and the SME sees it in their dashboard.
      fetch('/api/fund-tranche', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invoiceId: attestation.invoiceId }),
      }).then(() => loadDashboard(account)).catch(() => {})
    } catch (e: unknown) {
      setStep('review')
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  // Settle an ACTIVE invoice (simulates buyer repayment — oracle role)
  async function handleSettleInvoice(invoiceId: `0x${string}`) {
    if (!account) return
    setInvAction(invoiceId)
    try {
      const res  = await fetch('/api/settle-invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Settle failed')
      await loadDashboard(account)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    } finally {
      setInvAction(null)
    }
  }

  // Default an ACTIVE invoice (simulates buyer non-payment — oracle role)
  async function handleDefaultInvoice(invoiceId: `0x${string}`) {
    if (!account) return
    setInvAction(invoiceId)
    try {
      const res  = await fetch('/api/default-invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Default failed')
      await loadDashboard(account)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    } finally {
      setInvAction(null)
    }
  }

  // Feature 1: Reset form to submit another invoice
  function handleReset() {
    setStep('form')
    setAttestation(null)
    setStatus(null)
    setMintedTxHash(null)
    setDupWarn(null)
    setInvoiceNumber('')
    setFaceValue('10000')
    setDueDate('')
    setBuyerName('')
    setBuyerWallet('')
    setFile(null)
  }

  // ── Derived values ────────────────────────────────────────────────────────────

  const seniorAED = attestation ? (Number(attestation.faceValue) * 0.8).toLocaleString() : '0'
  const juniorAED = attestation ? (Number(attestation.faceValue) * 0.2).toLocaleString() : '0'

  const stepDots = [
    { label: 'Enter Details', active: step === 'form' || step === 'attesting', done: step !== 'form' && step !== 'attesting' },
    { label: 'Oracle Attests', active: step === 'attesting', done: step === 'review' || step === 'minting' || step === 'done' },
    { label: 'Tokenize', active: step === 'review' || step === 'minting' || step === 'done', done: step === 'done' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header fade-up">
        <div className="eyebrow">SME Portal</div>
        <h1>Tokenize an Invoice</h1>
        <p className="subtitle">
          Submit an invoice, get oracle-attested, receive DDSC liquidity instantly.
        </p>
      </div>

      {/* ── Wallet section ──────────────────────────────────────────────────────── */}
      <div className="fade-up-1">
        {account ? (
          /* Feature 9,10,11: Connected — show wallet bar with KYC, balances, disconnect */
          <div style={{
            padding: '0.85rem 1rem',
            background: 'rgba(0,53,95,0.3)',
            border: '1px solid var(--border-sub)',
            borderRadius: 10,
            display: 'flex',
            flexWrap: 'wrap' as const,
            alignItems: 'center',
            gap: '0.75rem',
          }}>
            {/* Address + KYC badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 200 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.8rem', color: 'var(--text)' }}>
                {fmtAddr(account)}
              </span>
              {/* Feature 9: KYC status badge */}
              {kycVerified === true && (
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--success)', background: 'rgba(61,207,142,0.12)', border: '1px solid rgba(61,207,142,0.3)', borderRadius: 4, padding: '0.15rem 0.4rem', letterSpacing: '0.08em' }}>
                  KYC ✓
                </span>
              )}
              {kycVerified === false && (
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--orange)', background: 'rgba(244,120,32,0.12)', border: '1px solid rgba(244,120,32,0.3)', borderRadius: 4, padding: '0.15rem 0.4rem', letterSpacing: '0.08em' }}>
                  KYC Pending
                </span>
              )}
            </div>

            {/* Feature 7: DDSC balance */}
            {ddscBalance !== null && (
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                <span style={{ color: 'var(--text-2)' }}>DDSC </span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#7fbadc', fontWeight: 600 }}>
                  {fmtDDSC(ddscBalance)}
                </span>
                {/* Hint: DDSC is 0 but J-DEBT > 0 means vault hasn't purchased yet */}
                {ddscBalance === 0n && juniorBalance !== null && juniorBalance > 0n && (
                  <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--orange)' }} title="Your invoice is Pending — DDSC arrives when the vault purchases the senior tranche (invoice → Active)">
                    ⏳ awaiting vault purchase
                  </span>
                )}
              </div>
            )}

            {/* Feature 8: J-DEBT balance */}
            {juniorBalance !== null && (
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                <span style={{ color: 'var(--text-2)' }}>J-DEBT </span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--orange)', fontWeight: 600 }}>
                  {fmtDDSC(juniorBalance)}
                </span>
                {juniorBalance > 0n && (
                  <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--muted)' }} title="Financing cost tokens — burned on settlement, wiped on default">
                    (financing cost)
                  </span>
                )}
              </div>
            )}

            {/* Feature 11: Disconnect */}
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleDisconnect}
              style={{ marginLeft: 'auto', marginTop: 0, padding: '0.25rem 0.65rem', fontSize: '0.72rem' }}
            >
              Disconnect
            </button>

            {/* Refresh dashboard */}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => loadDashboard(account)}
              disabled={dashboardLoading}
              title="Refresh balances & invoices"
              style={{ marginTop: 0, padding: '0.25rem 0.65rem', fontSize: '0.72rem' }}
            >
              {dashboardLoading ? '⟳' : '↻ Refresh'}
            </button>
          </div>
        ) : process.env.NEXT_PUBLIC_USE_LOCAL === 'true' ? (
          /* Local mode — pick Anvil test account */
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem', fontFamily: 'JetBrains Mono, monospace' }}>
              Local mode — pick an Anvil test account:
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const }}>
              {ANVIL_ACCOUNTS.map(a => (
                <button
                  key={a.label}
                  className="btn btn-secondary"
                  onClick={() => handleLocalConnect(a.key)}
                  title={a.address}
                  style={{ marginTop: 0 }}
                >
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

      {/* Tranche bar */}
      <div className="fade-up-2" style={{ marginTop: '1.5rem', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-sub)' }}>
        <div style={{ display: 'flex', height: 36 }}>
          <div style={{
            flex: 80, background: 'rgba(0,53,95,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.68rem', fontWeight: 700, color: 'rgba(143,168,189,0.9)',
            letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace',
            borderRight: '1px solid var(--border-sub)',
          }}>SENIOR · 80% → VAULT</div>
          <div style={{
            flex: 20, background: 'rgba(244,120,32,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.68rem', fontWeight: 700, color: 'var(--orange)',
            letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace',
          }}>JUNIOR · 20%</div>
        </div>
      </div>

      {/* ── STEP 1: Invoice form ───────────────────────────────────────────────── */}
      {(step === 'form' || step === 'attesting') && (
        <div className="card fade-up-2">
          <h2>Invoice Details</h2>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem' }}>
            {stepDots.map((s, i) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.62rem', fontWeight: 700,
                  background: s.done ? 'rgba(61,207,142,0.2)' : s.active ? 'var(--orange)' : 'rgba(0,53,95,0.5)',
                  color: s.done ? 'var(--success)' : s.active ? '#fff' : 'var(--muted)',
                  border: '1px solid ' + (s.done ? 'rgba(61,207,142,0.4)' : s.active ? 'var(--orange)' : 'var(--border-sub)'),
                }}>
                  {s.done ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: '0.7rem', color: s.active ? 'var(--text)' : s.done ? 'var(--success)' : 'var(--muted)', fontWeight: s.active ? 600 : 400 }}>
                  {s.label}
                </span>
                {i < 2 && <span style={{ color: 'var(--border-sub)', marginLeft: '0.2rem' }}>›</span>}
              </div>
            ))}
          </div>

          <label>Invoice Number</label>
          <input
            type="text"
            value={invoiceNumber}
            onChange={e => { setInvoiceNumber(e.target.value); setDupWarn(null) }}
            placeholder="e.g. INV-2024-001"
            disabled={step === 'attesting'}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label>Invoice Amount (AED)</label>
              <input
                type="number"
                value={faceValue}
                onChange={e => setFaceValue(e.target.value)}
                min="1"
                disabled={step === 'attesting'}
              />
            </div>
            <div>
              <label>Payment Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                disabled={step === 'attesting'}
              />
            </div>
          </div>

          <label>Buyer / Counterparty Name</label>
          <input
            type="text"
            value={buyerName}
            onChange={e => setBuyerName(e.target.value)}
            placeholder="e.g. Al Futtaim Trading LLC"
            disabled={step === 'attesting'}
          />

          <label>
            Buyer Wallet Address{' '}
            <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </label>
          <input
            type="text"
            value={buyerWallet}
            onChange={e => setBuyerWallet(e.target.value)}
            placeholder="0x… leave blank if unknown"
            disabled={step === 'attesting'}
          />

          <label>
            Invoice Document{' '}
            <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — PDF, image, etc.)</span>
          </label>
          {/* Feature 15: Document storage guidance */}
          <div
            onClick={() => step !== 'attesting' && fileRef.current?.click()}
            style={{
              border: '1px dashed ' + (file ? 'rgba(61,207,142,0.4)' : 'var(--border-sub)'),
              borderRadius: 9, padding: '1.5rem', textAlign: 'center',
              cursor: step === 'attesting' ? 'default' : 'pointer',
              background: file ? 'rgba(61,207,142,0.04)' : 'rgba(0,0,0,0.2)',
              transition: 'all 0.2s',
            }}
          >
            {file ? (
              <>
                <div style={{ fontSize: '0.82rem', color: 'var(--success)', fontWeight: 600 }}>✓ {file.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                  {(file.size / 1024).toFixed(1)} KB · SHA-256 will be anchored on-chain as docHash
                </div>
                <div style={{ fontSize: '0.7rem', color: 'rgba(244,120,32,0.7)', marginTop: '0.2rem' }}>
                  Keep the original file safe — only its hash is stored on-chain, not the file itself.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Click to upload invoice document</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.25rem', fontFamily: 'JetBrains Mono, monospace' }}>
                  Any file type · hash stored on-chain, document stays private
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                  Store the original file securely off-chain (e.g. your file server or cloud storage).
                </div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] ?? null)} />

          {/* Feature 17: Duplicate invoice warning */}
          {dupWarn && (
            <div style={{
              padding: '0.85rem 1rem', borderRadius: 8, marginTop: '0.5rem',
              background: 'rgba(244,120,32,0.1)', border: '1px solid rgba(244,120,32,0.4)',
            }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--orange)', margin: 0, marginBottom: '0.75rem' }}>
                ⚠ {dupWarn}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" style={{ marginTop: 0 }} onClick={doAttest}>
                  Submit Anyway
                </button>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 0 }} onClick={() => setDupWarn(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleAttest}
            disabled={step === 'attesting' || !account}
          >
            {step === 'attesting' ? '⟳ Requesting Oracle Attestation…' : 'Request Attestation →'}
          </button>

          {status && (
            <p className={`status ${status.type === 'error' ? 'error' : ''}`}>{status.msg}</p>
          )}
        </div>
      )}

      {/* ── STEP 2: Review & Tokenize ─────────────────────────────────────────── */}
      {(step === 'review' || step === 'minting') && attestation && (
        <div className="card fade-up-2">
          <h2>Review & Tokenize</h2>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem' }}>
            {stepDots.map((s, i) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.62rem', fontWeight: 700,
                  background: s.done ? 'rgba(61,207,142,0.2)' : s.active ? 'var(--orange)' : 'rgba(0,53,95,0.5)',
                  color: s.done ? 'var(--success)' : s.active ? '#fff' : 'var(--muted)',
                  border: '1px solid ' + (s.done ? 'rgba(61,207,142,0.4)' : s.active ? 'var(--orange)' : 'var(--border-sub)'),
                }}>
                  {s.done ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: '0.7rem', color: s.active ? 'var(--text)' : s.done ? 'var(--success)' : 'var(--muted)', fontWeight: s.active ? 600 : 400 }}>
                  {s.label}
                </span>
                {i < 2 && <span style={{ color: 'var(--border-sub)', marginLeft: '0.2rem' }}>›</span>}
              </div>
            ))}
          </div>

          {/* Attestation badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.85rem 1rem',
            background: 'rgba(61,207,142,0.06)', border: '1px solid rgba(61,207,142,0.2)',
            borderRadius: 9, marginBottom: '1.5rem',
          }}>
            <div style={{ color: 'var(--success)', fontSize: '1.1rem' }}>✓</div>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)' }}>Oracle Attestation Received</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '0.2rem' }}>
                {attestation.invoiceId.slice(0, 26)}…
              </div>
            </div>
          </div>

          {/* Summary grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Invoice #', value: attestation.invoiceNumber },
              { label: 'Buyer', value: attestation.buyerName },
              { label: 'Face Value', value: `${Number(attestation.faceValue).toLocaleString()} AED` },
              { label: 'Due Date', value: new Date(attestation.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) },
              ...(attestation.fileName ? [{ label: 'Document', value: attestation.fileName }] : []),
            ].map(row => (
              <div key={row.label} style={{ padding: '0.85rem 1rem', background: 'rgba(0,0,0,0.25)', borderRadius: 8, border: '1px solid var(--border-sub)' }}>
                <div style={{ fontSize: '0.62rem', textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: '0.35rem' }}>{row.label}</div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text)', fontWeight: 500 }}>{row.value}</div>
              </div>
            ))}
          </div>

          {/* Tranche split */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: 9, border: '1px solid var(--border-sub)', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: '0.75rem' }}>Tranche Split</div>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.85rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-2)', marginBottom: '0.2rem' }}>Senior → Vault (80%)</div>
                <div style={{ fontSize: '1.1rem', fontFamily: 'JetBrains Mono, monospace', color: '#7fbadc', fontWeight: 500 }}>{seniorAED} AED</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                  DDSC advanced to you when vault purchases (invoice → Active).{' '}
                  <span style={{ color: 'var(--text-2)' }}>Use ↻ Refresh to check your balance.</span>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-2)', marginBottom: '0.2rem' }}>Junior → You (20%)</div>
                <div style={{ fontSize: '1.1rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--orange)', fontWeight: 500 }}>{juniorAED} AED</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                  Your financing cost — burned on settlement, wiped on default.
                </div>
              </div>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleMint} disabled={step === 'minting'}>
            {step === 'minting' ? '⟳ Confirming on-chain…' : 'Tokenize Invoice'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setStep('form'); setStatus(null) }}
            style={{ width: '100%', marginTop: '0.75rem' }}
          >
            ← Edit Details
          </button>

          {status && (
            <p className={`status ${status.type === 'error' ? 'error' : status.type === 'success' ? 'success' : ''}`}>
              {status.msg}
            </p>
          )}
        </div>
      )}

      {/* ── STEP 3: Done ──────────────────────────────────────────────────────── */}
      {/* Features 1, 2, 13, 14 */}
      {step === 'done' && attestation && (
        <div className="card fade-up-2">
          {/* Success header */}
          <div style={{ textAlign: 'center', padding: '1rem 0 1.5rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✓</div>
            <h2 style={{ marginBottom: '0.35rem' }}>Invoice Tokenized!</h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-2)', margin: 0 }}>
              Your invoice is on-chain. The vault protocol is automatically funding it — your invoice
              will move to <strong style={{ color: '#7fbadc' }}>Active (Funded)</strong> and{' '}
              <strong style={{ color: '#7fbadc' }}>{seniorAED} DDSC</strong> will appear in your wallet shortly.
              Hit <strong>↻ Refresh</strong> in the wallet bar to see your updated balance.
            </p>
          </div>

          {/* Feature 14: Invoice ID after minting */}
          <div style={{ padding: '0.85rem 1rem', background: 'rgba(0,0,0,0.25)', borderRadius: 8, border: '1px solid var(--border-sub)', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.62rem', textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: '0.35rem' }}>Invoice ID</div>
            <div style={{ fontSize: '0.78rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', wordBreak: 'break-all' as const }}>
              {attestation.invoiceId}
            </div>
          </div>

          {/* Feature 2: Clickable tx hash explorer link */}
          {mintedTxHash && (
            <div style={{ padding: '0.85rem 1rem', background: 'rgba(61,207,142,0.05)', borderRadius: 8, border: '1px solid rgba(61,207,142,0.2)', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.62rem', textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: '0.35rem' }}>Transaction</div>
              {EXPLORER_URL ? (
                <a
                  href={`${EXPLORER_URL}/tx/${mintedTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.78rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)', wordBreak: 'break-all' as const, textDecoration: 'none' }}
                >
                  {mintedTxHash} ↗
                </a>
              ) : (
                <span style={{ fontSize: '0.78rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--success)', wordBreak: 'break-all' as const }}>
                  {mintedTxHash}
                </span>
              )}
            </div>
          )}

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Invoice #',   value: attestation.invoiceNumber },
              { label: 'Buyer',       value: attestation.buyerName },
              { label: 'Face Value',  value: `${Number(attestation.faceValue).toLocaleString()} AED` },
              { label: 'Due Date',    value: new Date(attestation.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) },
              { label: 'DDSC advance (on Active)',  value: `${seniorAED} AED` },
              { label: 'J-DEBT financing cost',    value: `${juniorAED} AED` },
            ].map(row => (
              <div key={row.label} style={{ padding: '0.85rem 1rem', background: 'rgba(0,0,0,0.25)', borderRadius: 8, border: '1px solid var(--border-sub)' }}>
                <div style={{ fontSize: '0.62rem', textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: '0.35rem' }}>{row.label}</div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text)', fontWeight: 500 }}>{row.value}</div>
              </div>
            ))}
          </div>

          {/* What happens next */}
          <div style={{ padding: '0.85rem 1rem', background: 'rgba(0,53,95,0.2)', borderRadius: 8, border: '1px solid var(--border-sub)', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: 'var(--muted)', marginBottom: '0.5rem' }}>What happens next</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.4rem' }}>
              {[
                { text: `Vault purchases senior tranche → ${seniorAED} DDSC lands in your wallet.`, color: '#7fbadc' },
                { text: `Buyer repays full face value before due date → oracle settles on-chain.`, color: 'var(--text-2)' },
                { text: `Default → J-DEBT wiped, you keep the DDSC advance.`, color: '#e05c5c' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.15rem', flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ fontSize: '0.82rem', color: item.color, lineHeight: 1.5 }}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Feature 1: Submit Another Invoice CTA */}
          <button className="btn btn-primary" onClick={handleReset}>
            Submit Another Invoice →
          </button>
        </div>
      )}

      {/* ── How It Works ──────────────────────────────────────────────────────── */}
      {/* Feature 13: Updated repayment guidance in step 4 */}
      {step === 'form' && (
        <div className="card fade-up-3">
          <h2>How It Works</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            {[
              { n: '1', text: 'Fill in your invoice details and optionally upload the document. The file is hashed locally — only the SHA-256 fingerprint goes on-chain, not the document itself. Store the original file securely off-chain.' },
              { n: '2', text: 'Our oracle verifies the invoice off-chain and returns a cryptographic attestation. You never see or handle the signature.' },
              { n: '3', text: 'Review and confirm. The invoice splits 80% senior (vault advance sent to your wallet as DDSC) and 20% junior (J-DEBT financing cost, burned on repayment).' },
              { n: '4', text: 'Ensure your buyer repays the full face value before the due date. The oracle settles on-chain and vault depositors earn yield.' },
            ].map(s => (
              <div key={s.n} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'rgba(244,120,32,0.15)', border: '1px solid rgba(244,120,32,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.72rem', fontWeight: 700, color: 'var(--orange)', flexShrink: 0,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>{s.n}</div>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-2)', lineHeight: 1.65, paddingTop: '0.3rem' }}>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── My Invoices Dashboard ─────────────────────────────────────────────── */}
      {/* Features 3, 4, 5, 6 */}
      {account && (
        <div className="card fade-up-3" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ margin: 0 }}>My Invoices</h2>
            {dashboardLoading && (
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Loading…</span>
            )}
          </div>

          {!dashboardLoading && myInvoices.length === 0 && (
            <p style={{ fontSize: '0.88rem', color: 'var(--muted)', textAlign: 'center', padding: '1.5rem 0' }}>
              No invoices submitted from this wallet yet.
            </p>
          )}

          {myInvoices.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {myInvoices.map(inv => {
                const days    = inv.dueSecs > 0n ? daysLeft(inv.dueSecs) : null
                const dueStr  = inv.dueSecs > 0n
                  ? new Date(Number(inv.dueSecs) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                  : '—'

                return (
                  <div key={inv.invoiceId} style={{
                    padding: '0.85rem 1rem',
                    background: 'rgba(0,0,0,0.2)',
                    border: `1px solid ${inv.state === 'ACTIVE' ? 'rgba(127,186,220,0.25)' : 'var(--border-sub)'}`,
                    borderRadius: 9,
                  }}>
                    {/* Top row: ID/amounts on left, state badge on right */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'start' }}>
                      {/* Left: ID + amounts */}
                      <div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>
                          {inv.invoiceId.slice(0, 14)}…{inv.invoiceId.slice(-6)}
                        </div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {fmtAED(inv.faceValue)}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', flexWrap: 'wrap' as const }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                            Senior: <span style={{ color: '#7fbadc' }}>{fmtAED(inv.seniorAmount)}</span>
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                            Junior: <span style={{ color: 'var(--orange)' }}>{fmtAED(inv.juniorAmount)}</span>
                          </span>
                        </div>
                        {/* Feature 6: Due date + countdown */}
                        <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
                          Due: <span style={{ color: 'var(--text-2)' }}>{dueStr}</span>
                          {days !== null && inv.state !== 'SETTLED' && inv.state !== 'DEFAULTED' && (
                            <span style={{
                              marginLeft: '0.5rem',
                              color: days < 0 ? '#e05c5c' : days <= 7 ? 'var(--orange)' : 'var(--muted)',
                              fontWeight: days <= 7 ? 600 : 400,
                            }}>
                              {days < 0 ? `(${Math.abs(days)}d overdue)` : `(${days}d remaining)`}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: State badge + note */}
                      <div style={{ textAlign: 'right' as const, minWidth: 120 }}>
                        <span style={{
                          display: 'inline-block',
                          fontSize: '0.65rem', fontWeight: 700,
                          color: stateColor(inv.state),
                          background: stateColor(inv.state) + '18',
                          border: `1px solid ${stateColor(inv.state)}44`,
                          borderRadius: 4,
                          padding: '0.2rem 0.5rem',
                          letterSpacing: '0.07em',
                          textTransform: 'uppercase' as const,
                        }}>
                          {stateLabel(inv.state)}
                        </span>
                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                          {inv.state === 'PENDING'   && 'Vault funding in progress…'}
                          {inv.state === 'ACTIVE'    && <>Vault funded ✓ — <span style={{ color: '#7fbadc' }}>{fmtAED(inv.seniorAmount)} DDSC</span> in wallet.</>}
                          {inv.state === 'SETTLED'   && <>Repaid. Vault earned <span style={{ color: 'var(--success)' }}>{fmtAED(inv.juniorAmount)} yield</span>.</>}
                          {inv.state === 'DEFAULTED' && 'J-DEBT wiped. You keep the DDSC advance.'}
                        </div>
                      </div>
                    </div>

                    {/* ACTIVE invoices: buyer repayment controls */}
                    {inv.state === 'ACTIVE' && (
                      <div style={{
                        display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const,
                        marginTop: '0.85rem', paddingTop: '0.85rem',
                        borderTop: '1px solid var(--border-sub)',
                      }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', width: '100%', marginBottom: '0.25rem' }}>
                          When your buyer pays, confirm it below to settle the invoice on-chain:
                        </div>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleSettleInvoice(inv.invoiceId)}
                          disabled={invAction === inv.invoiceId}
                          style={{ marginTop: 0, padding: '0.35rem 0.85rem', fontSize: '0.75rem' }}
                        >
                          {invAction === inv.invoiceId ? '⟳ Processing…' : 'Confirm Buyer Repaid'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDefaultInvoice(inv.invoiceId)}
                          disabled={invAction === inv.invoiceId}
                          style={{ marginTop: 0, padding: '0.35rem 0.85rem', fontSize: '0.75rem', color: '#e05c5c', borderColor: 'rgba(224,92,92,0.3)' }}
                        >
                          {invAction === inv.invoiceId ? '⟳' : 'Mark as Defaulted'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
