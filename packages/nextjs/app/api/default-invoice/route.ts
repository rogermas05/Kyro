import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

// Simulates an invoice default (buyer did not pay).
// Calls orchestrator.defaultInvoice(invoiceId) with 0 DDSC recovery.
// Junior (J-DEBT) is wiped entirely (SME's first-loss). Senior (S-DEBT) is burned
// with 0 recovery from the vault — the vault absorbs the loss on this invoice.
// Requires SETTLEMENT_ROLE on the orchestrator (held by FAUCET_PRIVATE_KEY / deployer).

const ORCHESTRATOR_ABI = [
  {
    name: 'invoices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'invoiceId', type: 'bytes32' }],
    outputs: [
      { name: 'sme',             type: 'address' },
      { name: 'seniorAmount',    type: 'uint256' },
      { name: 'juniorAmount',    type: 'uint256' },
      { name: 'seniorPurchased', type: 'bool'    },
      { name: 'settled',         type: 'bool'    },
    ],
  },
  {
    name: 'defaultInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'invoiceId', type: 'bytes32' }],
    outputs: [],
  },
] as const

export async function POST(req: NextRequest) {
  const key      = process.env.FAUCET_PRIVATE_KEY
  const orchAddr = process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS

  if (!key || !orchAddr) {
    return NextResponse.json({ error: 'Missing server env vars' }, { status: 500 })
  }

  let invoiceId: string
  try {
    ;({ invoiceId } = await req.json())
    if (!invoiceId?.startsWith('0x')) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Invalid body — expected { invoiceId: "0x…" }' }, { status: 400 })
  }

  const account = privateKeyToAccount(key as `0x${string}`)
  const pub  = createPublicClient({ chain: adi, transport: http() })
  const wc   = createWalletClient({ account, chain: adi, transport: http() })

  // Validate state
  const rec = await pub.readContract({
    address:      orchAddr as `0x${string}`,
    abi:          ORCHESTRATOR_ABI,
    functionName: 'invoices',
    args:         [invoiceId as `0x${string}`],
  })

  const [,,,purchased, settled] = rec
  if (settled)    return NextResponse.json({ error: 'Invoice already settled'                          }, { status: 400 })
  if (!purchased) return NextResponse.json({ error: 'Senior tranche not yet purchased — fund it first' }, { status: 400 })

  // Default with 0 recovery — no DDSC sent to orchestrator before calling
  const hash = await wc.writeContract({
    address:      orchAddr as `0x${string}`,
    abi:          ORCHESTRATOR_ABI,
    functionName: 'defaultInvoice',
    args:         [invoiceId as `0x${string}`],
  })
  await pub.waitForTransactionReceipt({ hash })

  return NextResponse.json({ hash })
}
