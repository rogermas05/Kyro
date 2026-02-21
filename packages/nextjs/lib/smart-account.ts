import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  pad,
  toHex,
  concat,
} from 'viem'

// ── Contract addresses (from env) ───────────────────────────────────────────

export const ENTRY_POINT   = (process.env.NEXT_PUBLIC_ENTRY_POINT_ADDRESS   ?? '0x0000000000000000000000000000000000000000') as Address
export const PAYMASTER     = (process.env.NEXT_PUBLIC_PAYMASTER_ADDRESS     ?? '0x0000000000000000000000000000000000000000') as Address
export const FACTORY       = (process.env.NEXT_PUBLIC_SMART_ACCOUNT_FACTORY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address

// ── ABIs (minimal) ──────────────────────────────────────────────────────────

export const FACTORY_ABI = [
  {
    type: 'function', name: 'getAddress',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'salt', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'createAccount',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'salt', type: 'uint256' }],
    outputs: [{ name: 'account', type: 'address' }],
    stateMutability: 'nonpayable',
  },
] as const

export const ENTRY_POINT_ABI = [
  {
    type: 'function', name: 'handleOps',
    inputs: [
      {
        name: 'ops', type: 'tuple[]', components: [
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
    outputs: [], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'getNonce',
    inputs: [{ name: 'sender', type: 'address' }, { name: 'key', type: 'uint192' }],
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getUserOpHash',
    inputs: [{
      name: 'userOp', type: 'tuple', components: [
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
    }],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const SMART_ACCOUNT_ABI = [
  {
    type: 'function', name: 'execute',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'executeBatch',
    inputs: [
      { name: 'targets', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'datas', type: 'bytes[]' },
    ],
    outputs: [], stateMutability: 'nonpayable',
  },
] as const

// ── Types ───────────────────────────────────────────────────────────────────

export type PackedUserOperation = {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: bigint
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

// ── Functions ───────────────────────────────────────────────────────────────

function packGas(high: bigint, low: bigint): Hex {
  return pad(toHex((high << 128n) | low), { size: 32 })
}

export async function predictSmartAccountAddress(
  publicClient: PublicClient,
  ownerEOA: Address
): Promise<Address> {
  return publicClient.readContract({
    address: FACTORY,
    abi: FACTORY_ABI,
    functionName: 'getAddress',
    args: [ownerEOA, 0n],
  })
}

export async function isAccountDeployed(
  publicClient: PublicClient,
  address: Address
): Promise<boolean> {
  const code = await publicClient.getCode({ address })
  return !!code && code !== '0x'
}

export async function buildUserOp(
  publicClient: PublicClient,
  sender: Address,
  callData: Hex,
  initCode?: Hex
): Promise<PackedUserOperation> {
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: ENTRY_POINT_ABI,
    functionName: 'getNonce',
    args: [sender, 0n],
  })

  return {
    sender,
    nonce,
    initCode: initCode ?? '0x',
    callData,
    accountGasLimits: packGas(200_000n, 100_000n),
    preVerificationGas: 50_000n,
    gasFees: packGas(1_000_000_000n, 1_000_000_000n),
    paymasterAndData: '0x',
    signature: '0x',
  }
}

export function buildInitCode(ownerEOA: Address): Hex {
  const factoryCalldata = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: 'createAccount',
    args: [ownerEOA, 0n],
  })
  return concat([FACTORY, factoryCalldata])
}

export function encodeExecute(target: Address, value: bigint, data: Hex): Hex {
  return encodeFunctionData({
    abi: SMART_ACCOUNT_ABI,
    functionName: 'execute',
    args: [target, value, data],
  })
}

export function encodeExecuteBatch(
  targets: Address[],
  values: bigint[],
  datas: Hex[]
): Hex {
  return encodeFunctionData({
    abi: SMART_ACCOUNT_ABI,
    functionName: 'executeBatch',
    args: [targets, values, datas],
  })
}

export async function getUserOpHash(
  publicClient: PublicClient,
  userOp: PackedUserOperation
): Promise<Hex> {
  return publicClient.readContract({
    address: ENTRY_POINT,
    abi: ENTRY_POINT_ABI,
    functionName: 'getUserOpHash',
    args: [userOp],
  }) as Promise<Hex>
}

export async function signUserOp(
  walletClient: WalletClient,
  userOpHash: Hex
): Promise<Hex> {
  const accounts = await walletClient.getAddresses()
  return walletClient.signMessage({
    account: accounts[0],
    message: { raw: userOpHash },
  })
}

export async function submitUserOp(
  walletClient: WalletClient,
  userOp: PackedUserOperation,
  beneficiary: Address
): Promise<Hex> {
  const accounts = await walletClient.getAddresses()
  return walletClient.writeContract({
    account: accounts[0],
    chain: null,
    address: ENTRY_POINT,
    abi: ENTRY_POINT_ABI,
    functionName: 'handleOps',
    args: [[userOp], beneficiary],
  })
}

/**
 * Full flow: build UserOp -> sponsor -> sign -> relay via backend.
 * The user only sees a single signMessage popup (no gas cost).
 * The backend relays the handleOps transaction using the sponsor key.
 * Returns the transaction hash.
 */
export async function sendSponsoredUserOp(
  publicClient: PublicClient,
  walletClient: WalletClient,
  smartAccount: Address,
  callData: Hex,
  initCode?: Hex
): Promise<Hex> {
  const userOp = await buildUserOp(publicClient, smartAccount, callData, initCode)

  // BigInt fields must be converted to strings for JSON serialization
  const toSerialisable = (op: PackedUserOperation) => ({
    ...op,
    nonce: op.nonce.toString(),
    preVerificationGas: op.preVerificationGas.toString(),
  })

  // 1. Request sponsorship from the backend
  const sponsorRes = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userOp: toSerialisable(userOp) }),
  })

  if (!sponsorRes.ok) {
    const detail = await sponsorRes.text()
    throw new Error(`Sponsorship failed: ${detail}`)
  }

  const { paymasterAndData } = await sponsorRes.json() as { paymasterAndData: Hex }
  userOp.paymasterAndData = paymasterAndData

  // 2. Sign the userOpHash with the owner's key (single wallet popup, no gas)
  const opHash = await getUserOpHash(publicClient, userOp)
  userOp.signature = await signUserOp(walletClient, opHash)

  // 3. Relay via backend — sponsor key pays for the outer handleOps tx
  const relayRes = await fetch('/api/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userOp: toSerialisable(userOp) }),
  })

  if (!relayRes.ok) {
    const detail = await relayRes.text()
    throw new Error(`Relay failed: ${detail}`)
  }

  const { txHash } = await relayRes.json() as { txHash: Hex }
  return txHash
}
