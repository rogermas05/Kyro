'use client'
import { useState } from 'react'
import { keccak256, encodePacked, parseUnits, toHex, padHex } from 'viem'
import { connectWallet, getPublicClient, getWalletClient } from '../../lib/wallet'
import { ORCHESTRATOR_ABI } from '../../lib/abis'

const ORCHESTRATOR = (process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO = '0x0000000000000000000000000000000000000000'

export default function SMEPage() {
  const [account, setAccount]         = useState<`0x${string}` | null>(null)
  const [status, setStatus]           = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [faceValue, setFaceValue]     = useState('10000')
  const [dueDate, setDueDate]         = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [zkProof, setZkProof]         = useState('')

  async function handleConnect() {
    try {
      const acct = await connectWallet()
      setAccount(acct)
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  async function handleMint() {
    if (!account) return setStatus({ msg: 'Connect your wallet first.', type: 'error' })
    if (!dueDate) return setStatus({ msg: 'Due date is required.', type: 'error' })
    if (!counterparty.startsWith('0x')) return setStatus({ msg: 'Counterparty must be a valid address.', type: 'error' })
    if (!zkProof.startsWith('0x')) return setStatus({ msg: 'Paste the 0x-prefixed ZK proof from your oracle.', type: 'error' })
    if (ORCHESTRATOR === ZERO) return setStatus({ msg: 'NEXT_PUBLIC_ORCHESTRATOR_ADDRESS not set — deploy contracts first.', type: 'error' })

    setStatus({ msg: 'Preparing transaction…', type: 'info' })
    try {
      const invoiceId = keccak256(encodePacked(['address', 'uint256'], [account, BigInt(Date.now())]))
      const faceWei   = parseUnits(faceValue, 18)
      const dueSecs   = BigInt(Math.floor(new Date(dueDate).getTime() / 1000))
      const docHash   = keccak256(encodePacked(['bytes32', 'uint256'], [invoiceId, faceWei]))

      const walletClient = getWalletClient(account)
      const hash = await walletClient.writeContract({
        address: ORCHESTRATOR,
        abi: ORCHESTRATOR_ABI,
        functionName: 'mintInvoice',
        args: [invoiceId, faceWei, dueSecs, docHash, counterparty as `0x${string}`, zkProof as `0x${string}`],
      })

      setStatus({ msg: `Invoice minted! Tx: ${hash}`, type: 'success' })
    } catch (e: unknown) {
      setStatus({ msg: (e as Error).message, type: 'error' })
    }
  }

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header fade-up">
        <div className="eyebrow">SME Portal</div>
        <h1>Invoice Onboarding</h1>
        <p className="subtitle">
          Tokenize a trade invoice through Kyro on ADI Chain. The senior tranche (80%) flows
          to the institutional vault for instant DDSC liquidity; the junior tranche (20%) stays
          with you as first-loss protection.
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

      {/* Tranche visualization */}
      <div className="fade-up-2" style={{
        marginTop: '1.5rem',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--border-sub)',
      }}>
        <div style={{ display: 'flex', height: 36 }}>
          <div style={{
            flex: 80,
            background: 'rgba(0,53,95,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.68rem', fontWeight: 700,
            color: 'rgba(143,168,189,0.9)',
            letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace',
            borderRight: '1px solid var(--border-sub)',
          }}>
            SENIOR · 80% → VAULT
          </div>
          <div style={{
            flex: 20,
            background: 'rgba(244,120,32,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.68rem', fontWeight: 700,
            color: 'var(--orange)',
            letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace',
          }}>
            JUNIOR · 20%
          </div>
        </div>
      </div>

      {/* Mint form */}
      <div className="card fade-up-2">
        <h2>Mint Invoice NFT</h2>

        <label>Face Value (AED)</label>
        <input
          type="number"
          value={faceValue}
          onChange={e => setFaceValue(e.target.value)}
          min="1"
        />

        <label>Due Date</label>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
        />

        <label>Counterparty Address (Buyer)</label>
        <input
          type="text"
          value={counterparty}
          onChange={e => setCounterparty(e.target.value)}
          placeholder="0x… buyer / importer wallet"
        />

        <label>ZK Proof (ECDSA oracle attestation)</label>
        <input
          type="text"
          value={zkProof}
          onChange={e => setZkProof(e.target.value)}
          placeholder="0x… 65-byte signature from off-chain oracle"
        />
        <p style={{
          fontSize: '0.75rem',
          color: 'var(--muted)',
          marginTop: '0.4rem',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          Call the oracle API with invoice details to receive a signed attestation.
        </p>

        <button className="btn btn-primary" onClick={handleMint} disabled={!account}>
          Mint Invoice
        </button>

        {status && (
          <p className={`status ${status.type === 'error' ? 'error' : status.type === 'success' ? 'success' : ''}`}>
            {status.msg}
          </p>
        )}
      </div>

      {/* How it works */}
      <div className="card fade-up-3">
        <h2>How It Works</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
          {[
            { n: '1', text: 'Originate an invoice with oracle-attested ZK proof of validity.' },
            { n: '2', text: '80% senior tranche is held in escrow; 20% junior tokens go to you.' },
            { n: '3', text: 'Vault operator purchases the senior tranche → you receive DDSC immediately.' },
            { n: '4', text: 'When the buyer repays, the vault settles and distributes yield to investors.' },
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'rgba(244,120,32,0.15)',
                border: '1px solid rgba(244,120,32,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 700,
                color: 'var(--orange)', flexShrink: 0,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {step.n}
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-2)', lineHeight: 1.65, paddingTop: '0.3rem' }}>
                {step.text}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
