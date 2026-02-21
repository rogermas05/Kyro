import { NextRequest, NextResponse } from 'next/server'

// Only meaningful on local Anvil — silently skipped on testnet.
// Calls anvil_setNonce to advance Anvil's nonce for a wallet address to match
// what the browser wallet (Rabby/MetaMask) thinks the next nonce should be.
// This prevents "nonce too high" / "wrong nonce" errors after an Anvil restart.

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_USE_LOCAL !== 'true') {
    return NextResponse.json({ status: 'skipped' })
  }

  const { wallet, nonce } = await req.json() as { wallet: string; nonce: number }

  await fetch('http://127.0.0.1:8545', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'anvil_setNonce',
      params: [wallet, '0x' + Number(nonce).toString(16)],
      id: 1,
    }),
  })

  return NextResponse.json({ status: 'ok' })
}
