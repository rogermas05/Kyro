'use client'
import { useEffect, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { getPublicClient } from '../../lib/wallet'
import { ORCHESTRATOR_ABI, VAULT_ABI, ERC20_ABI } from '../../lib/abis'

const ORCHESTRATOR = (process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const VAULT        = (process.env.NEXT_PUBLIC_VAULT_ADDRESS         ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const DDSC         = (process.env.NEXT_PUBLIC_DDSC_ADDRESS          ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const ZERO         = '0x0000000000000000000000000000000000000000'
const ONE_SHARE    = parseUnits('1', 18)

interface ProtocolData {
  totalInvoices: number
  ddscDisbursed: string
  tvl: string
  yieldPct: string
}

export function ProtocolStats() {
  const [data, setData] = useState<ProtocolData | null>(null)

  useEffect(() => {
    if (ORCHESTRATOR === ZERO || VAULT === ZERO) return
    ;(async () => {
      try {
        const pub = getPublicClient()
        const latest = await pub.getBlockNumber()
        const fromBlock = latest > 10_000n ? latest - 10_000n : 0n

        const [mintedEvents, totalAssets, sharePrice] = await Promise.all([
          pub.getContractEvents({
            address: ORCHESTRATOR, abi: ORCHESTRATOR_ABI,
            eventName: 'InvoiceMinted', fromBlock, toBlock: latest,
          }),
          pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' }) as Promise<bigint>,
          pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets', args: [ONE_SHARE] }) as Promise<bigint>,
        ])

        // Sum senior amounts across all minted invoices = total DDSC disbursed to SMEs
        let disbursed = 0n
        for (const e of mintedEvents) {
          const { seniorAmount } = e.args as { seniorAmount: bigint }
          disbursed += seniorAmount ?? 0n
        }

        const yieldNum = Number(sharePrice) / 1e18
        const yieldPct = yieldNum > 1 ? `+${((yieldNum - 1) * 100).toFixed(2)}%` : '0.00%'

        setData({
          totalInvoices: mintedEvents.length,
          ddscDisbursed: Number(formatUnits(disbursed, 18)).toLocaleString('en', { maximumFractionDigits: 0 }),
          tvl: Number(formatUnits(totalAssets as bigint, 18)).toLocaleString('en', { maximumFractionDigits: 0 }),
          yieldPct,
        })
      } catch { /* contracts not deployed — skip silently */ }
    })()
  }, [])

  if (!data) return null

  return (
    <div style={{
      display: 'flex',
      gap: '2.5rem',
      flexWrap: 'wrap',
      padding: '1.25rem 2rem',
      background: 'rgba(0,53,95,0.18)',
      borderTop: '1px solid rgba(0,53,95,0.4)',
      borderBottom: '1px solid rgba(0,53,95,0.4)',
    }}>
      <StatItem label="Invoices Funded" value={String(data.totalInvoices)} />
      <StatItem label="DDSC Disbursed" value={data.ddscDisbursed} unit="DDSC" />
      <StatItem label="Vault TVL" value={data.tvl} unit="DDSC" />
      <StatItem label="Vault Yield" value={data.yieldPct} positive={data.yieldPct.startsWith('+')} />
    </div>
  )
}

function StatItem({ label, value, unit, positive }: { label: string; value: string; unit?: string; positive?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <span style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.65rem',
        color: 'var(--muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>{label}</span>
      <span style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '1.1rem',
        fontWeight: 600,
        color: positive ? 'var(--success)' : 'var(--orange)',
      }}>
        {value}{unit && <span style={{ fontSize: '0.7rem', marginLeft: '0.3rem', color: 'var(--muted)' }}>{unit}</span>}
      </span>
    </div>
  )
}
