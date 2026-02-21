import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'registerIdentity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wallet',  type: 'address' },
      { name: 'country', type: 'uint16'  },
    ],
    outputs: [],
  },
  {
    name: 'setKycStatus',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wallet',   type: 'address' },
      { name: 'approved', type: 'bool'    },
    ],
    outputs: [],
  },
  {
    name: 'getIdentity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'registered',   type: 'bool'   },
          { name: 'kycApproved',  type: 'bool'   },
          { name: 'country',      type: 'uint16' },
        ],
      },
    ],
  },
] as const

export async function POST(req: NextRequest) {
  const key = process.env.FAUCET_PRIVATE_KEY   // deployer = COMPLIANCE_AGENT_ROLE
  const registryAddr = process.env.IDENTITY_REGISTRY_ADDRESS

  if (!key || !registryAddr) {
    return NextResponse.json(
      { error: 'FAUCET_PRIVATE_KEY or IDENTITY_REGISTRY_ADDRESS not configured' },
      { status: 500 }
    )
  }

  let wallet: string
  try {
    const body = await req.json()
    wallet = body.wallet
    if (!wallet || !wallet.startsWith('0x')) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Invalid body — expected { wallet: "0x…" }' }, { status: 400 })
  }

  const account = privateKeyToAccount(key as `0x${string}`)
  const pub = createPublicClient({ chain: adi, transport: http() })
  const wc  = createWalletClient({ account, chain: adi, transport: http() })

  const identity = await pub.readContract({
    address: registryAddr as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getIdentity',
    args: [wallet as `0x${string}`],
  }) as { registered: boolean; kycApproved: boolean }

  // Already fully verified — nothing to do
  if (identity.registered && identity.kycApproved) {
    return NextResponse.json({ status: 'already_verified' })
  }

  // Not yet registered — register first, wait for confirmation, then approve KYC
  if (!identity.registered) {
    const hash = await wc.writeContract({
      address: registryAddr as `0x${string}`,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'registerIdentity',
      args: [wallet as `0x${string}`, 784],
    })
    await pub.waitForTransactionReceipt({ hash })
  }

  // Approve KYC (runs whether we just registered or wallet was registered but not approved)
  const kycHash = await wc.writeContract({
    address: registryAddr as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setKycStatus',
    args: [wallet as `0x${string}`, true],
  })
  await pub.waitForTransactionReceipt({ hash: kycHash })

  return NextResponse.json({ status: 'registered' })
}
