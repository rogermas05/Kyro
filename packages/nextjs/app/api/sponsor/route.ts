import { NextResponse } from 'next/server'
import {
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  concat,
  pad,
  toHex,
  type Hex,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

const SPONSOR_KEY = process.env.SPONSOR_PRIVATE_KEY as `0x${string}` | undefined
const PAYMASTER   = process.env.NEXT_PUBLIC_PAYMASTER_ADDRESS as Address | undefined
const ENTRY_POINT = process.env.NEXT_PUBLIC_ENTRY_POINT_ADDRESS as Address | undefined
const VALIDITY_SECONDS = 300 // 5 minutes

type UserOpInput = {
  sender: Address
  nonce: string | bigint
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: string | bigint
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

export async function POST(req: Request) {
  if (!SPONSOR_KEY || !PAYMASTER || !ENTRY_POINT) {
    return NextResponse.json(
      { error: 'Sponsor not configured (missing SPONSOR_PRIVATE_KEY, PAYMASTER_ADDRESS, or ENTRY_POINT_ADDRESS)' },
      { status: 500 }
    )
  }

  const body = await req.json() as { userOp: UserOpInput }
  const { userOp } = body

  if (!userOp?.sender) {
    return NextResponse.json({ error: 'Missing userOp' }, { status: 400 })
  }

  try {
    const account = privateKeyToAccount(SPONSOR_KEY)
    const walletClient = createWalletClient({
      account,
      chain: adi,
      transport: http(),
    })

    const now = Math.floor(Date.now() / 1000)
    const validAfter = now - 300   // 5-minute buffer — ADI testnet clock runs ~4 min behind
    const validUntil = now + VALIDITY_SECONDS

    // Compute the paymaster hash (same as SignaturePaymaster.getHash on-chain)
    const hash = keccak256(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'address' },
          { type: 'uint48' },
          { type: 'uint48' },
        ],
        [
          userOp.sender,
          BigInt(userOp.nonce),
          keccak256(userOp.initCode),
          keccak256(userOp.callData),
          userOp.accountGasLimits as `0x${string}`,
          BigInt(userOp.preVerificationGas),
          userOp.gasFees as `0x${string}`,
          BigInt(adi.id),
          ENTRY_POINT,
          PAYMASTER,
          validUntil,
          validAfter,
        ]
      )
    )

    const signature = await walletClient.signMessage({
      message: { raw: hash },
    })

    // Build paymasterAndData
    const verGasLimit    = pad(toHex(100_000n), { size: 16 })
    const postOpGasLimit = pad(toHex(50_000n), { size: 16 })
    const validUntilHex  = pad(toHex(BigInt(validUntil)), { size: 6 })
    const validAfterHex  = pad(toHex(BigInt(validAfter)), { size: 6 })

    const paymasterAndData = concat([
      PAYMASTER,
      verGasLimit,
      postOpGasLimit,
      validUntilHex,
      validAfterHex,
      signature,
    ])

    return NextResponse.json({
      paymasterAndData,
      validUntil,
      validAfter,
    })
  } catch (err) {
    console.error('Sponsor signing error:', err)
    return NextResponse.json({ error: 'Signing failed' }, { status: 500 })
  }
}
