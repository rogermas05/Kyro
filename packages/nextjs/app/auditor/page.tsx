'use client'
import { useState } from 'react'
import { formatUnits } from 'viem'
import { getPublicClient } from '../../lib/wallet'
import { ORCHESTRATOR_ABI } from '../../lib/abis'

const ORCHESTRATOR = (process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO = '0x0000000000000000000000000000000000000000'

type EventKind = 'InvoiceMinted' | 'InvoiceSettled' | 'InvoiceDefaulted'

interface AuditRow {
  kind: EventKind
  invoiceId: string
  block: bigint
  extra: string
}

export default function AuditorPage() {
  const [rows, setRows]       = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError]     = useState('')

  async function fetchEvents() {
    if (ORCHESTRATOR === ZERO) {
      setError('NEXT_PUBLIC_ORCHESTRATOR_ADDRESS not set — deploy contracts first.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const pub = getPublicClient()
      const latest = await pub.getBlockNumber()
      const fromBlock = latest > 10_000n ? latest - 10_000n : 0n

      const [minted, settled, defaulted] = await Promise.all([
        pub.getContractEvents({
          address: ORCHESTRATOR, abi: ORCHESTRATOR_ABI,
          eventName: 'InvoiceMinted', fromBlock, toBlock: latest,
        }),
        pub.getContractEvents({
          address: ORCHESTRATOR, abi: ORCHESTRATOR_ABI,
          eventName: 'InvoiceSettled', fromBlock, toBlock: latest,
        }),
        pub.getContractEvents({
          address: ORCHESTRATOR, abi: ORCHESTRATOR_ABI,
          eventName: 'InvoiceDefaulted', fromBlock, toBlock: latest,
        }),
      ])

      const result: AuditRow[] = []

      for (const e of minted) {
        const { invoiceId, faceValue, seniorAmount, juniorAmount } = e.args as {
          invoiceId: `0x${string}`; faceValue: bigint; seniorAmount: bigint; juniorAmount: bigint
        }
        result.push({
          kind: 'InvoiceMinted',
          invoiceId: invoiceId?.slice(0, 10) + '…',
          block: e.blockNumber ?? 0n,
          extra: `Face ${fmt(faceValue)} — Senior ${fmt(seniorAmount)} / Junior ${fmt(juniorAmount)}`,
        })
      }

      for (const e of settled) {
        const { invoiceId, ddscRepaid } = e.args as { invoiceId: `0x${string}`; ddscRepaid: bigint }
        result.push({
          kind: 'InvoiceSettled',
          invoiceId: invoiceId?.slice(0, 10) + '…',
          block: e.blockNumber ?? 0n,
          extra: `Repaid ${fmt(ddscRepaid)} DDSC`,
        })
      }

      for (const e of defaulted) {
        const { invoiceId, recoveredAmount } = e.args as { invoiceId: `0x${string}`; recoveredAmount: bigint }
        result.push({
          kind: 'InvoiceDefaulted',
          invoiceId: invoiceId?.slice(0, 10) + '…',
          block: e.blockNumber ?? 0n,
          extra: `Recovered ${fmt(recoveredAmount)} DDSC`,
        })
      }

      result.sort((a, b) => Number(b.block - a.block))
      setRows(result)
      setFetched(true)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const fmt = (v: bigint) =>
    Number(formatUnits(v, 18)).toLocaleString('en', { maximumFractionDigits: 2 })

  const badgeClass: Record<EventKind, string> = {
    InvoiceMinted:    'badge badge-mint',
    InvoiceSettled:   'badge badge-settle',
    InvoiceDefaulted: 'badge badge-default',
  }

  return (
    <div className="page">

      {/* Header */}
      <div className="page-header fade-up">
        <div className="eyebrow">Auditor Portal</div>
        <h1>Compliance Dashboard</h1>
        <p className="subtitle">
          Live event feed from the InvoiceOrchestrator. Every invoice lifecycle event is
          verifiable on ADI Chain — minted, settled, or defaulted.
        </p>
      </div>

      {/* Event log */}
      <div className="card fade-up-1">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Invoice Events</h2>
          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchEvents}
            disabled={loading}
          >
            {loading ? 'Scanning…' : fetched ? 'Refresh' : 'Fetch Events'}
          </button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          Last 10,000 blocks · {ORCHESTRATOR !== ZERO ? ORCHESTRATOR.slice(0, 18) + '…' : 'Contract not set'}
        </p>

        {error && (
          <p className="status error" style={{ marginTop: '1rem' }}>{error}</p>
        )}

        {fetched && rows.length === 0 && !error && (
          <p style={{ marginTop: '1.5rem', color: 'var(--muted)', fontSize: '0.88rem', fontFamily: 'JetBrains Mono, monospace' }}>
            No invoice events found in the last 10,000 blocks.
          </p>
        )}

        {rows.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '1.25rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Invoice ID</th>
                  <th>Block</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <span className={badgeClass[r.kind]}>
                        {r.kind.replace('Invoice', '')}
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: '0.78rem' }}>{r.invoiceId}</span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: '0.78rem' }}>{r.block.toString()}</span>
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>{r.extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state before fetch */}
        {!fetched && !loading && (
          <div style={{
            marginTop: '2rem', padding: '3rem',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem',
            background: 'rgba(0,0,0,0.2)', borderRadius: 12,
            border: '1px dashed var(--border-sub)',
          }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="18" stroke="rgba(0,53,95,0.8)" strokeWidth="1.5"/>
              <path d="M20 12v10l5 5" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p style={{ fontSize: '0.88rem', color: 'var(--muted)', textAlign: 'center' }}>
              Click "Fetch Events" to scan the last 10,000 blocks for invoice lifecycle events.
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="card fade-up-2">
        <h2>Event Reference</h2>
        <table style={{ marginTop: '0.5rem' }}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Description</th>
              <th>Effect on Vault</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="badge badge-mint">Minted</span></td>
              <td style={{ fontSize: '0.85rem' }}>SME tokenized an invoice. Senior + junior tranches created on-chain.</td>
              <td style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>Awaiting vault purchase</td>
            </tr>
            <tr>
              <td><span className="badge badge-settle">Settled</span></td>
              <td style={{ fontSize: '0.85rem' }}>Invoice repaid in full. Vault received DDSC + yield.</td>
              <td style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>Share price increases</td>
            </tr>
            <tr>
              <td><span className="badge badge-default">Defaulted</span></td>
              <td style={{ fontSize: '0.85rem' }}>Invoice defaulted. Junior tranche wiped; senior partially recovered.</td>
              <td style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>Partial DDSC returned</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  )
}
