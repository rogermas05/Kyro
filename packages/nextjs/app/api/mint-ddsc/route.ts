import { NextRequest, NextResponse } from 'next/server'
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

// MockDDSC only exposes mint() to the owner (deployer = FAUCET_PRIVATE_KEY)
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

export async function POST(req: NextRequest) {
  const key = process.env.FAUCET_PRIVATE_KEY
  if (!key) return NextResponse.json({ error: 'FAUCET_PRIVATE_KEY not set' }, { status: 500 })

  const ddscAddr = process.env.NEXT_PUBLIC_DDSC_ADDRESS
  if (!ddscAddr) return NextResponse.json({ error: 'NEXT_PUBLIC_DDSC_ADDRESS not set' }, { status: 500 })

  let address: string
  let amount: string | undefined
  try {
    ;({ address, amount } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!address?.startsWith('0x')) {
    return NextResponse.json({ error: 'Valid wallet address required' }, { status: 400 })
  }

  // Default mint amount: 10,000 DDSC
  const mintWei = parseUnits(amount ?? '10000', 18)

  const account = privateKeyToAccount(key as `0x${string}`)
  const wallet  = createWalletClient({ account, chain: adi, transport: http() })
  const pub     = createPublicClient({ chain: adi, transport: http() })

  const hash = await wallet.writeContract({
    address:      ddscAddr as `0x${string}`,
    abi:          DDSC_ABI,
    functionName: 'mint',
    args:         [address as `0x${string}`, mintWei],
  })

  await pub.waitForTransactionReceipt({ hash })

  return NextResponse.json({ hash })
}
