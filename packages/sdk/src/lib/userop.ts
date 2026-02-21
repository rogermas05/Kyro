import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  keccak256,
  concat,
  toHex,
  pad,
  encodePacked,
} from "viem";
import { ENTRY_POINT_ABI, SIGNATURE_PAYMASTER_ABI } from "./abis.js";

export type PackedUserOperation = {
  sender:             Address;
  nonce:              bigint;
  initCode:           Hex;
  callData:           Hex;
  accountGasLimits:   Hex;
  preVerificationGas: bigint;
  gasFees:            Hex;
  paymasterAndData:   Hex;
  signature:          Hex;
};

function packGas(high: bigint, low: bigint): Hex {
  const packed = (high << 128n) | low;
  return pad(toHex(packed), { size: 32 });
}

export async function buildUserOp(
  publicClient: PublicClient,
  opts: {
    sender:       Address;
    callData:     Hex;
    entryPoint:   Address;
    initCode?:    Hex;
  }
): Promise<PackedUserOperation> {
  const nonce = await publicClient.readContract({
    address:      opts.entryPoint,
    abi:          ENTRY_POINT_ABI,
    functionName: "getNonce",
    args:         [opts.sender, 0n],
  });

  return {
    sender:             opts.sender,
    nonce,
    initCode:           opts.initCode ?? "0x",
    callData:           opts.callData,
    accountGasLimits:   packGas(200_000n, 100_000n),
    preVerificationGas: 50_000n,
    gasFees:            packGas(1_000_000_000n, 1_000_000_000n),
    paymasterAndData:   "0x",
    signature:          "0x",
  };
}

export async function getUserOpHash(
  publicClient: PublicClient,
  userOp: PackedUserOperation,
  entryPoint: Address
): Promise<Hex> {
  return publicClient.readContract({
    address:      entryPoint,
    abi:          ENTRY_POINT_ABI,
    functionName: "getUserOpHash",
    args:         [userOp],
  }) as Promise<Hex>;
}

/**
 * Compute the paymaster hash that the sponsor must sign.
 * Matches SignaturePaymaster.getHash() on-chain — hashes all UserOp fields
 * except paymasterAndData (avoids circular dependency) plus validity window.
 */
export function computePaymasterHash(
  userOp: PackedUserOperation,
  chainId: number,
  entryPoint: Address,
  paymaster: Address,
  validUntil: number,
  validAfter: number
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },  // sender
        { type: "uint256" },  // nonce
        { type: "bytes32" },  // keccak256(initCode)
        { type: "bytes32" },  // keccak256(callData)
        { type: "bytes32" },  // accountGasLimits
        { type: "uint256" },  // preVerificationGas
        { type: "bytes32" },  // gasFees
        { type: "uint256" },  // chainId
        { type: "address" },  // entryPoint
        { type: "address" },  // paymaster
        { type: "uint48" },   // validUntil
        { type: "uint48" },   // validAfter
      ],
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        userOp.accountGasLimits as `0x${string}`,
        userOp.preVerificationGas,
        userOp.gasFees as `0x${string}`,
        BigInt(chainId),
        entryPoint,
        paymaster,
        validUntil,
        validAfter,
      ]
    )
  );
}

/**
 * Compute the ERC20 paymaster hash (includes maxTokenCost).
 */
export function computeERC20PaymasterHash(
  userOp: PackedUserOperation,
  chainId: number,
  entryPoint: Address,
  paymaster: Address,
  validUntil: number,
  validAfter: number,
  maxTokenCost: bigint
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint48" },
        { type: "uint48" },
        { type: "uint256" },
      ],
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        userOp.accountGasLimits as `0x${string}`,
        userOp.preVerificationGas,
        userOp.gasFees as `0x${string}`,
        BigInt(chainId),
        entryPoint,
        paymaster,
        validUntil,
        validAfter,
        maxTokenCost,
      ]
    )
  );
}

/**
 * Build paymasterAndData for the native SignaturePaymaster.
 * Layout: [paymaster 20B][verGasLimit 16B][postOpGasLimit 16B][validUntil 6B][validAfter 6B][sig 65B]
 */
export function buildNativePaymasterAndData(
  paymaster: Address,
  validUntil: number,
  validAfter: number,
  sponsorSig: Hex
): Hex {
  const verGasLimit    = pad(toHex(100_000n), { size: 16 });
  const postOpGasLimit = pad(toHex(50_000n),  { size: 16 });

  const validUntilHex = pad(toHex(BigInt(validUntil)), { size: 6 });
  const validAfterHex = pad(toHex(BigInt(validAfter)), { size: 6 });

  return concat([paymaster, verGasLimit, postOpGasLimit, validUntilHex, validAfterHex, sponsorSig]);
}

/**
 * Build paymasterAndData for the ERC20 paymaster.
 * Layout: [paymaster 20B][verGas 16B][postGas 16B][validUntil 6B][validAfter 6B][maxTokenCost 32B][sig 65B]
 */
export function buildERC20PaymasterAndData(
  paymaster: Address,
  validUntil: number,
  validAfter: number,
  maxTokenCost: bigint,
  sponsorSig: Hex
): Hex {
  const verGasLimit    = pad(toHex(100_000n), { size: 16 });
  const postOpGasLimit = pad(toHex(50_000n),  { size: 16 });
  const validUntilHex  = pad(toHex(BigInt(validUntil)), { size: 6 });
  const validAfterHex  = pad(toHex(BigInt(validAfter)), { size: 6 });
  const maxTokenHex    = pad(toHex(maxTokenCost), { size: 32 });

  return concat([paymaster, verGasLimit, postOpGasLimit, validUntilHex, validAfterHex, maxTokenHex, sponsorSig]);
}
