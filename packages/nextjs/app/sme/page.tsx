'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { keccak256, encodePacked, parseUnits, formatUnits, encodeFunctionData } from 'viem'
import {
  getPublicClient, getWalletClient,
} from '../../lib/wallet'
import { ORCHESTRATOR_ABI, ERC20_ABI, IDENTITY_REGISTRY_ABI } from '../../lib/abis'
import { adi } from '../../lib/chain'
import { useWallet } from '../context/WalletContext'
import {
  sendSponsoredUserOp,
  encodeExecute,
  buildInitCode,
  ENTRY_POINT,
  FACTORY,
} from '../../lib/smart-account'

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
  const { account, smartAccount, smartAccountDeployed, refreshSmartAccount } = useWallet()
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
  const [parsing, setParsing]             = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Duplicate-invoice warning
  const [dupWarn, setDupWarn] = useState<string | null>(null)

  // Dashboard state
  const [ddscBalance,      setDdscBalance]      = useState<bigint | null>(null)
  const [juniorBalance,    setJuniorBalance]     = useState<bigint | null>(null)
  const [kycVerified,      setKycVerified]       = useState<boolean | null>(null)
  const [myInvoices,       setMyInvoices]        = useState<InvoiceItem[]>([])
  const [dashboardLoading, setDashboardLoading]  = useState(false)
  const [invoicesOpen,     setInvoicesOpen]      = useState(false)
  // Which invoice is currently being settled/defaulted
  const [invAction,        setInvAction]         = useState<string | null>(null)

  // ── Effects ──────────────────────────────────────────────────────────────────

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
  const loadDashboard = useCallback(async (acct: `0x${string}`, smartAcct?: `0x${string}`) => {
    setDashboardLoading(true)
    const pub = getPublicClient()
    const primaryAddr = smartAcct ?? acct
    try {
      // Feature 7: DDSC balance (check both EOA and smart account)
      if (DDSC_ADDR !== ZERO) {
        let bal = await pub.readContract({ address: DDSC_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] })
        if (smartAcct && smartAcct !== acct) {
          const saBal = await pub.readContract({ address: DDSC_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [smartAcct] })
          bal = bal + saBal
        }
        setDdscBalance(bal)
      }

      // Feature 8: Junior (J-DEBT) balance
      if (JUNIOR_ADDR !== ZERO) {
        let bal = await pub.readContract({ address: JUNIOR_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [primaryAddr] })
        if (smartAcct && smartAcct !== acct) {
          const eoBal = await pub.readContract({ address: JUNIOR_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct] })
          bal = bal + eoBal
        }
        setJuniorBalance(bal)
      }

      // Feature 9: KYC status (verified if either address is verified)
      if (IDENTITY_REG !== ZERO) {
        let verified = await pub.readContract({ address: IDENTITY_REG, abi: IDENTITY_REGISTRY_ABI, functionName: 'isVerified', args: [acct] })
        if (!verified && smartAcct && smartAcct !== acct) {
          verified = await pub.readContract({ address: IDENTITY_REG, abi: IDENTITY_REGISTRY_ABI, functionName: 'isVerified', args: [smartAcct] })
        }
        setKycVerified(verified)
      }

      // Features 3,4,5,6: My Invoices (query both EOA and smart account)
      if (ORCHESTRATOR !== ZERO) {
        const eoaEvts = await pub.getContractEvents({
          address:   ORCHESTRATOR,
          abi:       ORCHESTRATOR_ABI,
          eventName: 'InvoiceMinted',
          args:      { sme: acct },
          fromBlock: 0n,
          toBlock:   'latest',
        })
        let mintedEvts = eoaEvts
        if (smartAcct && smartAcct !== acct) {
          const saEvts = await pub.getContractEvents({
            address:   ORCHESTRATOR,
            abi:       ORCHESTRATOR_ABI,
            eventName: 'InvoiceMinted',
            args:      { sme: smartAcct },
            fromBlock: 0n,
            toBlock:   'latest',
          })
          mintedEvts = [...eoaEvts, ...saEvts]
        }

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
      loadDashboard(account, smartAccount ?? undefined)
    } else {
      setDdscBalance(null)
      setJuniorBalance(null)
      setKycVerified(null)
      setMyInvoices([])
    }
  }, [account, smartAccount, loadDashboard])

  // Reset form state when wallet disconnects
  useEffect(() => {
    if (!account) {
      setStep('form')
      setAttestation(null)
      setStatus(null)
      setMintedTxHash(null)
      setDupWarn(null)
    }
  }, [account])

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
    setStatus({ msg: 'Registering smart account with KYC registry…', type: 'info' })

    try {
      // Register BOTH the EOA and the smart account for KYC
      const registerWallet = smartAccount ?? account
      await fetch('/api/register-sme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: registerWallet }),
      })
      // Also register EOA as fallback
      if (smartAccount && smartAccount !== account) {
        await fetch('/api/register-sme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: account }),
        })
      }

      setStatus({ msg: 'Requesting oracle attestation…', type: 'info' })

      const faceWei = parseUnits(faceValue, 18)
      const dueSecs = BigInt(Math.floor(new Date(dueDate).getTime() / 1000))
      const docHash = file ? await hashFile(file) : hashMetadata(invoiceNumber, faceValue, dueDate)
      const buyer   = (buyerWallet.startsWith('0x') ? buyerWallet : ZERO) as `0x${string}`

      // Use smart account address as the wallet for attestation if available
      const attestWallet = smartAccount ?? account
      const res = await fetch('/api/attest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: attestWallet,
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

      let hash: `0x${string}`

      const useAA = smartAccount && ENTRY_POINT !== '0x0000000000000000000000000000000000000000'

      if (useAA) {
        // Gas-sponsored flow via smart account UserOp
        setStatus({ msg: 'Building sponsored UserOperation…', type: 'info' })

        const mintCalldata = encodeFunctionData({
          abi: ORCHESTRATOR_ABI,
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

        const executeCalldata = encodeExecute(ORCHESTRATOR, 0n, mintCalldata)
        const initCode = !smartAccountDeployed ? buildInitCode(account) : undefined

        hash = await sendSponsoredUserOp(
          pubClient,
          walletClient,
          smartAccount!,
          executeCalldata,
          initCode
        )
      } else {
        // Direct EOA call (fallback when AA is not configured)
        hash = await walletClient.writeContract({
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
      }

      setStatus({ msg: 'Transaction submitted, confirming…', type: 'info' })
      const receipt = await pubClient.waitForTransactionReceipt({ hash, timeout: 60_000 })

      if (receipt.status === 'reverted') {
        setStep('review')
        setStatus({ msg: 'Transaction reverted — wallet may not be KYC-registered.', type: 'error' })
        return
      }

      // Refresh smart account deployment status after first use
      if (useAA && !smartAccountDeployed) {
        refreshSmartAccount()
      }

      try {
        const stored: StoredInvoice = {
          invoiceId:     attestation.invoiceId,
          invoiceNumber: attestation.invoiceNumber,
          faceValue:     attestation.faceValue,
          dueDate:       attestation.dueDate,
        }
        localStorage.setItem(`sme_inv_${attestation.invoiceId}`, JSON.stringify(stored))

        const senderAddr = (smartAccount ?? account).toLowerCase()
        const dupKey = `sme_submitted_${senderAddr}`
        const nums   = JSON.parse(localStorage.getItem(dupKey) ?? '[]') as string[]
        if (!nums.includes(attestation.invoiceNumber)) {
          nums.push(attestation.invoiceNumber)
          localStorage.setItem(dupKey, JSON.stringify(nums))
        }

        localStorage.removeItem('sme_form_draft')
      } catch { /* ignore */ }

      setMintedTxHash(hash)
      setStep('done')
      setStatus(null)

      loadDashboard(account, smartAccount ?? undefined)

      fetch('/api/fund-tranche', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invoiceId: attestation.invoiceId }),
      }).then(() => loadDashboard(account, smartAccount ?? undefined)).catch(() => {})
    } catch (e: unknown) {
      setStep('review')
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  // Settle an ACTIVE invoice — SME wallet transfers faceValue DDSC to orchestrator, then oracle settles
  async function handleSettleInvoice(invoiceId: `0x${string}`, faceValue: bigint) {
    if (!account) return
    setInvAction(invoiceId)
    try {
      const walletClient = getWalletClient(account)
      const pub = getPublicClient()

      const useAA = smartAccount && ENTRY_POINT !== '0x0000000000000000000000000000000000000000'

      if (useAA) {
        // Ensure smart account has enough DDSC to repay (demo: top up if short)
        const smaBal = await pub.readContract({ address: DDSC_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [smartAccount!] })
        if (smaBal < faceValue) {
          await fetch('/api/mint-ddsc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: smartAccount, amount: formatUnits(faceValue - smaBal, 18) }),
          })
        }

        setStatus({ msg: 'Building sponsored DDSC transfer…', type: 'info' })
        const transferData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [ORCHESTRATOR, faceValue],
        })
        const callData = encodeExecute(DDSC_ADDR, 0n, transferData)
        const txHash = await sendSponsoredUserOp(pub, walletClient, smartAccount!, callData)
        const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status === 'reverted') throw new Error('DDSC transfer reverted — check your balance')
      } else {
        // Ensure EOA has enough DDSC to repay (demo: top up if short)
        const eoaBal = await pub.readContract({ address: DDSC_ADDR, abi: ERC20_ABI, functionName: 'balanceOf', args: [account as `0x${string}`] })
        if (eoaBal < faceValue) {
          await fetch('/api/mint-ddsc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: account, amount: formatUnits(faceValue - eoaBal, 18) }),
          })
        }

        setStatus({ msg: 'Waiting for wallet — transfer DDSC to orchestrator…', type: 'info' })
        const transferHash = await walletClient.writeContract({
          address: DDSC_ADDR,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [ORCHESTRATOR, faceValue],
        })
        const transferReceipt = await pub.waitForTransactionReceipt({ hash: transferHash })
        if (transferReceipt.status === 'reverted') throw new Error('DDSC transfer reverted — check your balance')
      }

      setStatus({ msg: 'Settling invoice on-chain…', type: 'info' })
      const res  = await fetch('/api/settle-invoice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Settle failed')
      setStatus({ msg: 'Invoice settled — funds forwarded to vault.', type: 'success' })
      await loadDashboard(account, smartAccount ?? undefined)
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
      await loadDashboard(account, smartAccount ?? undefined)
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

  // ── Invoice auto-parse ────────────────────────────────────────────────────────

  async function handleFileChange(f: File | null) {
    setFile(f)
    if (!f) return
    setParsing(true)
    await new Promise(r => setTimeout(r, 900))
    setInvoiceNumber('INV-' + Math.floor(1000 + Math.random() * 9000))
    setFaceValue('7900')
    setDueDate('2026-04-14')
    setBuyerName('Al Naboodah Construction')
    setParsing(false)
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

      {/* ── Account info strip (shown when connected) ────────────────────────────── */}
      {account && (
        <div className="fade-up-1" style={{ marginBottom: '1.5rem', background: 'rgba(0,53,95,0.3)', border: '1px solid var(--border-sub)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: '0.6rem', padding: '0.7rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 160 }}>
              {kycVerified === true && (
                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--success)', background: 'rgba(61,207,142,0.12)', border: '1px solid rgba(61,207,142,0.3)', borderRadius: 4, padding: '0.12rem 0.4rem' }}>KYC ✓</span>
              )}
              {kycVerified === false && (
                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--orange)', background: 'rgba(244,120,32,0.1)', border: '1px solid rgba(244,120,32,0.3)', borderRadius: 4, padding: '0.12rem 0.4rem' }}>KYC Pending</span>
              )}
            </div>
            {ddscBalance !== null && (
              <span style={{ fontSize: '0.73rem', color: 'var(--muted)' }}>
                DDSC <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#7fbadc', fontWeight: 600 }}>{fmtDDSC(ddscBalance)}</span>
                {ddscBalance === 0n && juniorBalance !== null && juniorBalance > 0n && (
                  <span style={{ marginLeft: '0.35rem', fontSize: '0.65rem', color: 'var(--orange)' }} title="DDSC arrives when vault purchases the senior tranche">⏳</span>
                )}
              </span>
            )}
            {juniorBalance !== null && juniorBalance > 0n && (
              <span style={{ fontSize: '0.73rem', color: 'var(--muted)' }}>
                J-DEBT <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--orange)', fontWeight: 600 }}>{fmtDDSC(juniorBalance)}</span>
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => loadDashboard(account, smartAccount ?? undefined)} disabled={dashboardLoading} style={{ marginTop: 0, marginLeft: 'auto' }}>
              {dashboardLoading ? '⟳' : '↻'}
            </button>
          </div>
          {smartAccount && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 1rem', borderTop: '1px solid rgba(61,207,142,0.15)', background: 'rgba(61,207,142,0.04)', fontSize: '0.71rem' }}>
              <span style={{ color: 'var(--success)', fontWeight: 700 }}>Smart Account</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#7fbadc', fontSize: '0.68rem' }}>{fmtAddr(smartAccount)}</span>
              <span style={{ fontSize: '0.6rem', fontWeight: 600, color: smartAccountDeployed ? 'var(--success)' : 'var(--orange)', background: smartAccountDeployed ? 'rgba(61,207,142,0.12)' : 'rgba(244,120,32,0.1)', border: `1px solid ${smartAccountDeployed ? 'rgba(61,207,142,0.3)' : 'rgba(244,120,32,0.3)'}`, borderRadius: 4, padding: '0.1rem 0.35rem' }}>
                {smartAccountDeployed ? 'Deployed' : 'Counterfactual'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '0.6rem', fontWeight: 700, color: 'var(--success)', background: 'rgba(61,207,142,0.12)', border: '1px solid rgba(61,207,142,0.3)', borderRadius: 4, padding: '0.1rem 0.35rem' }}>
                Gas Sponsored
              </span>
            </div>
          )}
          <div style={{ padding: '0.45rem 1rem', background: 'rgba(244,120,32,0.05)', borderTop: '1px solid rgba(244,120,32,0.15)', fontSize: '0.71rem', color: 'var(--muted)' }}>
            <span style={{ color: 'var(--orange)', fontWeight: 600 }}>⚑ Testnet —</span>{' '}
            KYC auto-approved · Oracle signs any request · You simulate buyer repayment from your own wallet
          </div>
        </div>
      )}

      {/* ── My Invoices Dashboard — shown FIRST when invoices exist ──────────── */}
      {account && myInvoices.length > 0 && (
        <div className="card fade-up-2" style={{ marginTop: 0 }}>
          <div
            onClick={() => setInvoicesOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: invoicesOpen ? '1.25rem' : 0, cursor: 'pointer', userSelect: 'none' }}
          >
            <h2 style={{ margin: 0 }}>My Invoices <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 400, fontFamily: 'JetBrains Mono, monospace' }}>({myInvoices.length})</span></h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {dashboardLoading && <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Loading…</span>}
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem', transition: 'transform 0.2s', display: 'inline-block', transform: invoicesOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
            </div>
          </div>
          {invoicesOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {myInvoices.map(inv => {
              const days   = inv.dueSecs > 0n ? daysLeft(inv.dueSecs) : null
              const dueStr = inv.dueSecs > 0n
                ? new Date(Number(inv.dueSecs) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—'
              return (
                <div key={inv.invoiceId} style={{
                  padding: '0.85rem 1rem',
                  background: 'rgba(0,0,0,0.2)',
                  border: `1px solid ${inv.state === 'ACTIVE' ? 'rgba(127,186,220,0.25)' : 'var(--border-sub)'}`,
                  borderRadius: 9,
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'start' }}>
                    <div>
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>
                        {inv.invoiceId.slice(0, 14)}…{inv.invoiceId.slice(-6)}
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtAED(inv.faceValue)}
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', flexWrap: 'wrap' as const }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Senior: <span style={{ color: '#7fbadc' }}>{fmtAED(inv.seniorAmount)}</span></span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Junior: <span style={{ color: 'var(--orange)' }}>{fmtAED(inv.juniorAmount)}</span></span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
                        Due: <span style={{ color: 'var(--text-2)' }}>{dueStr}</span>
                        {days !== null && inv.state !== 'SETTLED' && inv.state !== 'DEFAULTED' && (
                          <span style={{ marginLeft: '0.5rem', color: days < 0 ? '#e05c5c' : days <= 7 ? 'var(--orange)' : 'var(--muted)', fontWeight: days <= 7 ? 600 : 400 }}>
                            {days < 0 ? `(${Math.abs(days)}d overdue)` : `(${days}d remaining)`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' as const, minWidth: 120 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        fontSize: '0.65rem', fontWeight: 700,
                        color: stateColor(inv.state),
                        background: stateColor(inv.state) + '18',
                        border: `1px solid ${stateColor(inv.state)}44`,
                        borderRadius: 4, padding: '0.2rem 0.5rem',
                        letterSpacing: '0.07em', textTransform: 'uppercase' as const,
                      }}>
                        {inv.state === 'ACTIVE' && <span className="live-dot" style={{ background: '#7fbadc', boxShadow: 'none', animation: 'active-pulse 1.8s ease-in-out infinite', width: 6, height: 6 }} />}
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
                  {inv.state === 'ACTIVE' && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const, marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border-sub)' }}>
                      {days !== null && (
                        <div style={{ width: '100%', marginBottom: '0.35rem' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '0.7rem', fontWeight: 600,
                            padding: '0.25rem 0.7rem', borderRadius: 99,
                            background: days < 0 ? 'rgba(224,92,92,0.12)' : days <= 7 ? 'rgba(244,120,32,0.12)' : 'rgba(0,53,95,0.3)',
                            border: `1px solid ${days < 0 ? 'rgba(224,92,92,0.35)' : days <= 7 ? 'rgba(244,120,32,0.35)' : 'rgba(0,53,95,0.5)'}`,
                            color: days < 0 ? '#e05c5c' : days <= 7 ? 'var(--orange)' : 'var(--text-2)',
                          }}>
                            {days < 0 ? `⚠ ${Math.abs(days)}d overdue` : days === 0 ? '⚠ Due today' : `⏱ Due in ${days}d`}
                          </span>
                        </div>
                      )}
                      <div style={{ fontSize: '0.68rem', color: 'var(--muted)', width: '100%', marginBottom: '0.25rem' }}>
                        <span style={{ color: 'var(--orange)', fontWeight: 600 }}>Demo: </span>
                        Your wallet simulates buyer repayment by transferring the face value in DDSC.
                      </div>
                      <button className="btn btn-secondary" onClick={() => handleSettleInvoice(inv.invoiceId, inv.faceValue)} disabled={invAction === inv.invoiceId} style={{ marginTop: 0, padding: '0.35rem 0.85rem', fontSize: '0.75rem' }}>
                        {invAction === inv.invoiceId ? '⟳ Processing…' : 'Simulate Repayment'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDefaultInvoice(inv.invoiceId)} disabled={invAction === inv.invoiceId} style={{ marginTop: 0, padding: '0.35rem 0.85rem', fontSize: '0.75rem', color: '#e05c5c', borderColor: 'rgba(224,92,92,0.3)' }}>
                        {invAction === inv.invoiceId ? '⟳' : 'Mark as Defaulted'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>}
        </div>
      )}

      {/* ── STEP 1: Invoice form ───────────────────────────────────────────────── */}
      {(step === 'form' || step === 'attesting') && (
        <div className="two-col" style={{ marginTop: '1.5rem', alignItems: 'start' }}>
        {/* Left: Form card */}
        <div className="card fade-up-2" style={{ margin: 0 }}>
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

          {/* Upload zone — always shown first */}
          <div
            onClick={() => step !== 'attesting' && !parsing && fileRef.current?.click()}
            style={{
              border: '1px dashed ' + (file ? 'rgba(61,207,142,0.4)' : parsing ? 'var(--orange)' : 'var(--border-sub)'),
              borderRadius: 9, padding: '2rem', textAlign: 'center',
              cursor: (step === 'attesting' || parsing) ? 'default' : 'pointer',
              background: file ? 'rgba(61,207,142,0.04)' : parsing ? 'rgba(244,120,32,0.04)' : 'rgba(0,0,0,0.2)',
              transition: 'all 0.2s',
              marginBottom: '0.25rem',
            }}
          >
            {parsing ? (
              <>
                <div style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>⟳</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--orange)', fontWeight: 600 }}>Reading invoice…</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                  Extracting fields automatically
                </div>
              </>
            ) : file ? (
              <>
                <div style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>✓</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--success)', fontWeight: 600 }}>{file.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                  {(file.size / 1024).toFixed(1)} KB · click to replace
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 }}>↑</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600 }}>Upload Invoice</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                  PDF or image — fields will be filled automatically
                </div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />

          {/* Fields — only shown after file is parsed */}
          {file && !parsing && (
            <>
              <div style={{ marginTop: '1.5rem', marginBottom: '0.5rem', borderTop: '1px solid var(--border-sub)', paddingTop: '1.25rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Extracted Details — review &amp; edit if needed</span>
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
            </>
          )}

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
            disabled={step === 'attesting' || !account || !file || parsing}
          >
            {step === 'attesting' ? '⟳ Requesting Oracle Attestation…' : 'Request Attestation →'}
          </button>

          {status && (
            <p className={`status ${status.type === 'error' ? 'error' : ''}`}>{status.msg}</p>
          )}
        </div>{/* end left card */}

        {/* Right: Live funding preview */}
        <div className="card fade-up-3" style={{ margin: 0, position: 'sticky' as const, top: 'calc(var(--nav-h) + 1rem)' }}>
          <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>Funding Preview</div>
          {faceValue && Number(faceValue) > 0 ? (
            <>
              {/* Hero number */}
              <div style={{ textAlign: 'center' as const, padding: '1.25rem 0 1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '0.4rem' }}>
                  You&apos;ll receive immediately
                </div>
                <div style={{ fontSize: '3rem', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: '#7fbadc', lineHeight: 1 }}>
                  {(Number(faceValue) * 0.8).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginTop: '0.4rem' }}>AED as DDSC (80% of face value)</div>
              </div>
              {/* Visual bar */}
              <div style={{ borderRadius: 7, overflow: 'hidden', marginBottom: '1rem', border: '1px solid var(--border-sub)' }}>
                <div style={{ display: 'flex', height: 28 }}>
                  <div style={{ flex: 80, background: 'rgba(127,186,220,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.62rem', fontWeight: 700, color: '#7fbadc', letterSpacing: '0.08em', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                    80% SENIOR
                  </div>
                  <div style={{ flex: 20, background: 'rgba(244,120,32,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.62rem', fontWeight: 700, color: 'var(--orange)', letterSpacing: '0.06em' }}>
                    20%
                  </div>
                </div>
              </div>
              {/* Breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.85rem', background: 'rgba(127,186,220,0.07)', border: '1px solid rgba(127,186,220,0.15)', borderRadius: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.1rem' }}>Senior → Vault</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>DDSC advance to wallet</div>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.95rem', fontWeight: 600, color: '#7fbadc' }}>
                    {(Number(faceValue) * 0.8).toLocaleString()} <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>AED</span>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.85rem', background: 'rgba(244,120,32,0.05)', border: '1px solid rgba(244,120,32,0.15)', borderRadius: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: '0.1rem' }}>Junior → You</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>Financing cost (returned if repaid)</div>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.95rem', fontWeight: 600, color: 'var(--orange)' }}>
                    {(Number(faceValue) * 0.2).toLocaleString()} <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>AED</span>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                DDSC lands in your wallet when the vault purchases the senior tranche (invoice → Active).
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center' as const, padding: '2.5rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
              Enter an invoice amount to see the funding breakdown.
            </div>
          )}
        </div>
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
            {/* Animated ring celebration */}
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, marginBottom: '1rem' }}>
              {/* Expanding rings */}
              {[0, 0.4, 0.8].map((delay, i) => (
                <div key={i} style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  border: '2px solid rgba(61,207,142,0.7)',
                  animation: `pulse-ring 2s ${delay}s ease-out infinite`,
                }} />
              ))}
              {/* Core circle */}
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(61,207,142,0.12)',
                border: '2px solid rgba(61,207,142,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.6rem', color: 'var(--success)',
                boxShadow: '0 0 24px rgba(61,207,142,0.3)',
              }}>✓</div>
            </div>
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

      {/* Status at bottom when in review/done/minting steps */}
      {status && step !== 'form' && step !== 'attesting' && (
        <p className={`status ${status.type === 'error' ? 'error' : status.type === 'success' ? 'success' : ''}`}>
          {status.msg}
        </p>
      )}

    </div>
  )
}
