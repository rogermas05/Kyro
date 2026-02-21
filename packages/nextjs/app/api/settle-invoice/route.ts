import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

// SME wallet transfers faceValue DDSC to the orchestrator (done client-side before this is called).
// This route calls orchestrator.settleInvoice(invoiceId) — burns S-DEBT + J-DEBT, forwards DDSC to vault.
// The vault's totalAssets increases by the financing yield (junior amount), so share price rises.
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
    name: 'settleInvoice',
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

  // Validate invoice state
  const rec = await pub.readContract({
    address:      orchAddr as `0x${string}`,
    abi:          ORCHESTRATOR_ABI,
    functionName: 'invoices',
    args:         [invoiceId as `0x${string}`],
  })

  const [,, , purchased, settled] = rec
  if (settled)    return NextResponse.json({ error: 'Invoice already settled'                          }, { status: 400 })
  if (!purchased) return NextResponse.json({ error: 'Senior tranche not yet purchased — fund it first' }, { status: 400 })

  // Settle the invoice — burns S-DEBT + J-DEBT, forwards DDSC (sent by SME) to vault
  const hash = await wc.writeContract({
    address:      orchAddr as `0x${string}`,
    abi:          ORCHESTRATOR_ABI,
    functionName: 'settleInvoice',
    args:         [invoiceId as `0x${string}`],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') {
    return NextResponse.json({ error: 'settleInvoice transaction reverted — check roles and balances' }, { status: 500 })
  }

  return NextResponse.json({ hash })
}
