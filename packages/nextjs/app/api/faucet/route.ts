import { NextRequest, NextResponse } from 'next/server'
import { createWalletClient, http, parseEther, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Anvil chain definition (server-side copy — can't import from lib/chain in API routes)
const anvil = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
})

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_USE_LOCAL !== 'true') {
    return NextResponse.json({ error: 'Faucet only available in local dev mode' }, { status: 403 })
  }

  const key = process.env.FAUCET_PRIVATE_KEY
  if (!key) {
    return NextResponse.json({ error: 'FAUCET_PRIVATE_KEY not set' }, { status: 500 })
  }

  let address: string
  try {
    ;({ address } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!address?.startsWith('0x')) {
    return NextResponse.json({ error: 'Valid address required' }, { status: 400 })
  }

  const account = privateKeyToAccount(key as `0x${string}`)
  const client = createWalletClient({ account, chain: anvil, transport: http('http://127.0.0.1:8545') })

  const hash = await client.sendTransaction({
    to: address as `0x${string}`,
    value: parseEther('1'),
  })

  return NextResponse.json({ hash })
}
