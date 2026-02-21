import { NextResponse } from 'next/server'
import {
  createWalletClient,
  createPublicClient,
  http,
  decodeEventLog,
  type Hex,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from '../../../lib/chain'

const SPONSOR_KEY = process.env.SPONSOR_PRIVATE_KEY as `0x${string}` | undefined
const ENTRY_POINT = process.env.NEXT_PUBLIC_ENTRY_POINT_ADDRESS as Address | undefined

const ENTRY_POINT_ABI = [
  {
    type: 'function' as const,
    name: 'handleOps',
    inputs: [
      {
        name: 'ops',
        type: 'tuple[]',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'accountGasLimits', type: 'bytes32' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'gasFees', type: 'bytes32' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
  {
    type: 'event' as const,
    name: 'UserOperationEvent',
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'paymaster', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'success', type: 'bool', indexed: false },
      { name: 'actualGasCost', type: 'uint256', indexed: false },
      { name: 'actualGasUsed', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event' as const,
    name: 'UserOperationRevertReason',
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'revertReason', type: 'bytes', indexed: false },
    ],
  },
] as const

type UserOpInput = {
  sender: Address
  nonce: string
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: string
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

export async function POST(req: Request) {
  if (!SPONSOR_KEY || !ENTRY_POINT) {
    return NextResponse.json(
      { error: 'Relay not configured (missing SPONSOR_PRIVATE_KEY or ENTRY_POINT_ADDRESS)' },
      { status: 500 }
    )
  }

  const body = await req.json() as { userOp: UserOpInput }
  const { userOp } = body

  if (!userOp?.sender || !userOp?.signature || userOp.signature === '0x') {
    return NextResponse.json({ error: 'Missing or unsigned userOp' }, { status: 400 })
  }

  try {
    const account = privateKeyToAccount(SPONSOR_KEY)
    const walletClient = createWalletClient({
      account,
      chain: adi,
      transport: http(),
    })
    const publicClient = createPublicClient({
      chain: adi,
      transport: http(),
    })

    const onChainOp = {
      sender: userOp.sender,
      nonce: BigInt(userOp.nonce),
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits: userOp.accountGasLimits,
      preVerificationGas: BigInt(userOp.preVerificationGas),
      gasFees: userOp.gasFees,
      paymasterAndData: userOp.paymasterAndData,
      signature: userOp.signature,
    }

    const txHash = await walletClient.writeContract({
      address: ENTRY_POINT,
      abi: ENTRY_POINT_ABI,
      functionName: 'handleOps',
      args: [[onChainOp], account.address],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })

    let innerSuccess = true
    let revertReason: string | undefined

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: ENTRY_POINT_ABI, data: log.data, topics: log.topics })
        if (decoded.eventName === 'UserOperationEvent') {
          const args = decoded.args as { success: boolean }
          innerSuccess = args.success
        }
        if (decoded.eventName === 'UserOperationRevertReason') {
          const args = decoded.args as { revertReason: Hex }
          revertReason = args.revertReason
        }
      } catch { /* skip non-EP logs */ }
    }

    if (!innerSuccess) {
      console.error(`[relay] UserOp inner execution failed. tx=${txHash}, revert=${revertReason ?? 'unknown'}`)
      return NextResponse.json({
        error: `UserOperation execution reverted${revertReason ? ': ' + revertReason : ''}`,
        txHash,
      }, { status: 422 })
    }

    return NextResponse.json({
      txHash,
      status: receipt.status,
    })
  } catch (err: unknown) {
    console.error('Relay error:', err)
    const msg = err instanceof Error ? err.message : 'Relay failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
