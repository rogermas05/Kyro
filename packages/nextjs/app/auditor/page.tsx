'use client'
import { useState, useEffect } from 'react'
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

  useEffect(() => { fetchEvents() }, [])

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

        {/* Timeline */}
        {rows.length > 0 && (
          <div style={{ marginTop: '1.5rem', position: 'relative' }}>
            {/* Vertical line */}
            <div style={{
              position: 'absolute', left: 19, top: 0, bottom: 0,
              width: 2,
              background: 'linear-gradient(180deg, rgba(0,53,95,0.8) 0%, rgba(0,53,95,0.1) 100%)',
            }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {rows.map((r, i) => {
                const dotColor =
                  r.kind === 'InvoiceMinted'    ? 'var(--orange)' :
                  r.kind === 'InvoiceSettled'   ? 'var(--success)' :
                  '#e05c5c'
                const icon =
                  r.kind === 'InvoiceMinted'    ? '◆' :
                  r.kind === 'InvoiceSettled'   ? '✓' :
                  '✕'
                return (
                  <div key={i} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', paddingBottom: '1.25rem' }}>
                    {/* Dot */}
                    <div style={{
                      width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: dotColor + '18',
                      border: `2px solid ${dotColor}`,
                      color: dotColor,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      zIndex: 1,
                    }}>
                      {icon}
                    </div>
                    {/* Content */}
                    <div style={{
                      flex: 1,
                      background: 'rgba(0,0,0,0.18)',
                      border: `1px solid ${dotColor}22`,
                      borderRadius: 8,
                      padding: '0.65rem 0.9rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                        <span className={badgeClass[r.kind]} style={{ fontSize: '0.62rem' }}>
                          {r.kind.replace('Invoice', '')}
                        </span>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--muted)' }}>
                          {r.invoiceId}
                        </span>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' }}>
                          block {r.block.toString()}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-2)', margin: 0 }}>{r.extra}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <p style={{ marginTop: '1.5rem', color: 'var(--muted)', fontSize: '0.88rem', fontFamily: 'JetBrains Mono, monospace' }}>
            Scanning chain for events…
          </p>
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
