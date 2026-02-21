import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  keccak256,
  concat,
  toHex,
  pad,
} from "viem";
import { ENTRY_POINT_ABI } from "./abis.js";

export type PackedUserOperation = {
  sender:             Address;
  nonce:              bigint;
  initCode:           Hex;
  callData:           Hex;
  accountGasLimits:   Hex;   // bytes32: verificationGasLimit | callGasLimit
  preVerificationGas: bigint;
  gasFees:            Hex;   // bytes32: maxPriorityFeePerGas | maxFeePerGas
  paymasterAndData:   Hex;
  signature:          Hex;
};

/** Pack two 128-bit gas values into a single bytes32 */
function packGas(high: bigint, low: bigint): Hex {
  const packed = (high << 128n) | low;
  return pad(toHex(packed), { size: 32 });
}

/**
 * Build a minimal PackedUserOperation for calling a single function on a target contract.
 * Gas limits are fixed conservative defaults suitable for the ADI testnet demo.
 */
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
    accountGasLimits:   packGas(200_000n, 100_000n), // verificationGasLimit | callGasLimit
    preVerificationGas: 50_000n,
    gasFees:            packGas(1_000_000_000n, 1_000_000_000n), // 1 gwei | 1 gwei
    paymasterAndData:   "0x",
    signature:          "0x",
  };
}

/**
 * Compute the ERC-4337 userOpHash for a PackedUserOperation.
 * hash = keccak256(abi.encode(keccak256(abi.encode(userOp)), entryPoint, chainId))
 */
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
 * Build the paymasterAndData field.
 * Layout: [paymaster 20B] [verGasLimit 16B] [postOpGasLimit 16B] [sponsorSig 65B]
 */
export function buildPaymasterAndData(paymaster: Address, sponsorSig: Hex): Hex {
  const verGasLimit    = pad(toHex(100_000n), { size: 16 });
  const postOpGasLimit = pad(toHex(50_000n),  { size: 16 });
  return concat([paymaster, verGasLimit, postOpGasLimit, sponsorSig]);
}

/**
 * Compute the hash the sponsor service must sign.
 * sponsorHash = keccak256(userOpHash || chainId || paymaster)
 */
export function buildSponsorHash(
  userOpHash: Hex,
  chainId: number,
  paymaster: Address
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [userOpHash, BigInt(chainId), paymaster]
    )
  );
}
