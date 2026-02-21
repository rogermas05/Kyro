import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

// Simulates buyer repayment and settlement.
// 1. Mints faceValue DDSC to the orchestrator (simulating the buyer paying back in full).
// 2. Calls orchestrator.settleInvoice(invoiceId) — burns S-DEBT + J-DEBT, forwards DDSC to vault.
// The vault's totalAssets increases by the financing yield (junior amount), so share price rises.
// Requires SETTLEMENT_ROLE on the orchestrator (held by FAUCET_PRIVATE_KEY / deployer).

const DDSC_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',     type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

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
  const ddscAddr = process.env.NEXT_PUBLIC_DDSC_ADDRESS
  const orchAddr = process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS

  if (!key || !ddscAddr || !orchAddr) {
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

  // Read invoice to get amounts and validate state
  const rec = await pub.readContract({
    address:      orchAddr as `0x${string}`,
    abi:          ORCHESTRATOR_ABI,
    functionName: 'invoices',
    args:         [invoiceId as `0x${string}`],
  })

  const [, seniorAmt, juniorAmt, purchased, settled] = rec
  if (settled)    return NextResponse.json({ error: 'Invoice already settled'                          }, { status: 400 })
  if (!purchased) return NextResponse.json({ error: 'Senior tranche not yet purchased — fund it first' }, { status: 400 })

  // Mint the full face value (senior + junior) to the orchestrator.
  // This simulates the buyer sending their payment on-chain.
  const faceValue = seniorAmt + juniorAmt
  const mintHash = await wc.writeContract({
    address:      ddscAddr as `0x${string}`,
    abi:          DDSC_ABI,
    functionName: 'mint',
    args:         [orchAddr as `0x${string}`, faceValue],
  })
  await pub.waitForTransactionReceipt({ hash: mintHash })

  // Settle the invoice — burns S-DEBT + J-DEBT, forwards all DDSC to vault
  const hash = await wc.writeContract({
    address:      orchAddr as `0x${string}`,
    abi:          ORCHESTRATOR_ABI,
    functionName: 'settleInvoice',
    args:         [invoiceId as `0x${string}`],
  })
  await pub.waitForTransactionReceipt({ hash })

  return NextResponse.json({ hash, faceValue: faceValue.toString() })
}
