import {
  type Address,
  type Hex,
  encodeFunctionData,
} from "viem";
import { makeClients } from "../lib/wallet.js";
import { buildUserOp, getUserOpHash } from "../lib/userop.js";
import { ENTRY_POINT_ABI, SIMPLE_SMART_ACCOUNT_ABI } from "../lib/abis.js";

export interface SendUserOpOptions {
  ownerKey:       string;
  account:        string;
  entryPoint:     string;
  to:             string;
  data:           string;
  sponsorUrl:     string;
  paymasterType:  string;
  maxTokenCost?:  string;
  rpc?:           string;
}

export async function sendUserOp(opts: SendUserOpOptions): Promise<void> {
  const { publicClient, walletClient, account: signerAccount } = makeClients(
    opts.ownerKey as `0x${string}`,
    opts.rpc
  );

  const smartAccount = opts.account as Address;
  const entryPoint   = opts.entryPoint as Address;

  const balance = await publicClient.getBalance({ address: smartAccount });
  console.log(`\n  Smart Account:     ${smartAccount}`);
  console.log(`  ADI Balance:        ${balance} wei  ${balance === 0n ? "<- ZERO (gas is sponsored!)" : ""}`);
  console.log(`  Entry Point:        ${entryPoint}`);
  console.log(`  Target:             ${opts.to}`);
  console.log(`  Paymaster Type:     ${opts.paymasterType}`);

  const innerCallData = encodeFunctionData({
    abi:          SIMPLE_SMART_ACCOUNT_ABI,
    functionName: "execute",
    args:         [opts.to as Address, 0n, opts.data as Hex],
  });

  console.log("\n  Building UserOperation...");
  const userOp = await buildUserOp(publicClient, {
    sender:     smartAccount,
    callData:   innerCallData,
    entryPoint,
  });

  console.log(`  Requesting sponsorship from ${opts.sponsorUrl}...`);
  const sponsorResponse = await fetch(`${opts.sponsorUrl}/sign`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      userOp,
      paymasterType: opts.paymasterType,
      maxTokenCost: opts.maxTokenCost,
    }),
  });

  if (!sponsorResponse.ok) {
    const detail = await sponsorResponse.text();
    throw new Error(`Sponsor service rejected: ${detail}`);
  }

  const { paymasterAndData, validUntil, validAfter } = await sponsorResponse.json() as {
    paymasterAndData: Hex;
    validUntil: number;
    validAfter: number;
  };

  console.log(`  Sponsored [${new Date(validAfter * 1000).toISOString()} → ${new Date(validUntil * 1000).toISOString()}]`);
  userOp.paymasterAndData = paymasterAndData;

  console.log("\n  Signing UserOperation with account owner key...");
  const finalHash = await getUserOpHash(publicClient, userOp, entryPoint);
  const ownerSig  = await walletClient.signMessage({
    message: { raw: finalHash },
  });
  userOp.signature = ownerSig;

  console.log("\n  Submitting to EntryPoint (self-hosted bundler mode)...");
  const txHash = await walletClient.writeContract({
    address:      entryPoint,
    abi:          ENTRY_POINT_ABI,
    functionName: "handleOps",
    args:         [[userOp], signerAccount.address],
  });

  console.log(`\n  Tx sent: ${txHash}`);
  console.log("  Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log(`\n  UserOperation executed!`);
  console.log(`  Block:    ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed}`);
  console.log(`  Explorer: https://explorer.ab.testnet.adifoundation.ai/tx/${txHash}`);
  console.log(`\n  Zero-balance wallet successfully called the target contract!`);
}
