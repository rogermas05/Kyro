import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

// Operator (deployer) calls vault.purchaseSeniorTranche(invoiceId).
// This sends DDSC from the vault to the SME and transfers S-DEBT to the vault.
// Invoice moves from PENDING → ACTIVE.
// Requires OPERATOR_ROLE on the vault (held by FAUCET_PRIVATE_KEY / deployer).

const DDSC_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
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
] as const

const VAULT_ABI = [
  {
    name: 'purchaseSeniorTranche',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'invoiceId', type: 'bytes32' }],
    outputs: [],
  },
] as const

export async function POST(req: NextRequest) {
  const key          = process.env.FAUCET_PRIVATE_KEY
  const vaultAddr    = process.env.NEXT_PUBLIC_VAULT_ADDRESS
  const ddscAddr     = process.env.NEXT_PUBLIC_DDSC_ADDRESS
  const orchAddr     = process.env.NEXT_PUBLIC_ORCHESTRATOR_ADDRESS

  if (!key || !vaultAddr || !ddscAddr || !orchAddr) {
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

  // Read invoice to get the seniorAmount so we can verify vault has enough DDSC
  const rec = await pub.readContract({
    address:      orchAddr as `0x${string}`,
    abi:          ORCHESTRATOR_ABI,
    functionName: 'invoices',
    args:         [invoiceId as `0x${string}`],
  })

  const [smeAddr, seniorAmt, juniorAmt, purchased, settled] = rec
  if (purchased) return NextResponse.json({ error: 'Senior tranche already purchased' }, { status: 400 })
  if (settled)   return NextResponse.json({ error: 'Invoice already settled'           }, { status: 400 })

  // If vault doesn't have enough DDSC (local demo only), mint what's needed
  const vaultBal = await pub.readContract({
    address:      ddscAddr as `0x${string}`,
    abi:          DDSC_ABI,
    functionName: 'balanceOf',
    args:         [vaultAddr as `0x${string}`],
  })

  if (vaultBal < seniorAmt) {
    const needed = seniorAmt - vaultBal
    const mintHash = await wc.writeContract({
      address:      ddscAddr as `0x${string}`,
      abi:          DDSC_ABI,
      functionName: 'mint',
      args:         [vaultAddr as `0x${string}`, needed],
    })
    const mintReceipt = await pub.waitForTransactionReceipt({ hash: mintHash })
    if (mintReceipt.status === 'reverted') {
      return NextResponse.json({ error: 'DDSC mint transaction reverted' }, { status: 500 })
    }
  }

  // Call vault.purchaseSeniorTranche — sends DDSC to SME, receives S-DEBT
  const hash = await wc.writeContract({
    address:      vaultAddr as `0x${string}`,
    abi:          VAULT_ABI,
    functionName: 'purchaseSeniorTranche',
    args:         [invoiceId as `0x${string}`],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') {
    return NextResponse.json({ error: 'purchaseSeniorTranche transaction reverted — check roles and vault balance' }, { status: 500 })
  }

  // Mint juniorAmount DDSC to the SME so they have the full faceValue to settle (demo only)
  if (juniorAmt > 0n) {
    const juniorMintHash = await wc.writeContract({
      address:      ddscAddr as `0x${string}`,
      abi:          DDSC_ABI,
      functionName: 'mint',
      args:         [smeAddr, juniorAmt],
    })
    await pub.waitForTransactionReceipt({ hash: juniorMintHash })
  }

  return NextResponse.json({ hash, seniorAmount: seniorAmt.toString() })
}
