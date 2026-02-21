import { NextRequest, NextResponse } from 'next/server'
import { keccak256, encodePacked, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ── Oracle signing endpoint ────────────────────────────────────────────────────
//
// This is the "ZK oracle" service. In production this would be a hardened
// backend that verifies invoice documents before signing. For demo/testnet
// it signs any well-formed request using the trusted oracle key.
//
// Required env var (server-side only, never exposed to browser):
//   ORACLE_PRIVATE_KEY — the private key of the address set as trustedOracle
//                        in InvoiceZKVerifier. For local anvil this is
//                        Anvil account #2: 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

export async function POST(req: NextRequest) {
  const key = process.env.ORACLE_PRIVATE_KEY
  if (!key) {
    return NextResponse.json({ error: 'ORACLE_PRIVATE_KEY not configured' }, { status: 500 })
  }

  let body: {
    walletAddress: string
    invoiceNumber: string
    faceValue: string   // uint256 as decimal string
    dueSecs: string     // uint64 as decimal string
    docHash: string     // bytes32 hex
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletAddress, invoiceNumber, faceValue, dueSecs, docHash } = body

  if (!walletAddress || !invoiceNumber || !faceValue || !dueSecs || !docHash) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // ── 1. Compute deterministic invoiceId ────────────────────────────────────
  // keccak256(abi.encodePacked(walletAddress, invoiceNumber))
  // Using the SME's wallet + their invoice number gives a unique, reproducible ID.
  const invoiceId = keccak256(
    encodePacked(['address', 'string'], [walletAddress as `0x${string}`, invoiceNumber])
  )

  // ── 2. Build the message the contract will verify ─────────────────────────
  // Matches InvoiceZKVerifier.verifyProof():
  //   keccak256(abi.encodePacked(invoiceId, faceValue, dueDate, docHash))
  const messageHash = keccak256(
    encodePacked(
      ['bytes32', 'uint256', 'uint64', 'bytes32'],
      [
        invoiceId as `0x${string}`,
        BigInt(faceValue),
        BigInt(dueSecs),
        docHash as `0x${string}`,
      ]
    )
  )

  // ── 3. Sign with oracle key (EIP-191, matches toEthSignedMessageHash) ─────
  const account = privateKeyToAccount(key as `0x${string}`)
  const proof = await account.signMessage({ message: { raw: hexToBytes(messageHash) } })

  return NextResponse.json({ invoiceId, proof })
}
