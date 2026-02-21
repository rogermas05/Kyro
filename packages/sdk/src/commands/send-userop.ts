import {
  type Address,
  type Hex,
  encodeFunctionData,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeClients } from "../lib/wallet.js";
import { buildUserOp, getUserOpHash, buildPaymasterAndData } from "../lib/userop.js";
import { ENTRY_POINT_ABI, SIMPLE_SMART_ACCOUNT_ABI } from "../lib/abis.js";

export interface SendUserOpOptions {
  ownerKey:    string;         // Smart account owner's private key
  account:     string;         // Smart account address
  entryPoint:  string;         // EntryPoint contract address
  to:          string;         // Target contract to call
  data:        string;         // Calldata (hex) for the target call
  sponsorUrl:  string;         // URL of the adig sponsor:sign server
  rpc?:        string;
}

export async function sendUserOp(opts: SendUserOpOptions): Promise<void> {
  const { publicClient, walletClient, account: signerAccount } = makeClients(
    opts.ownerKey as `0x${string}`,
    opts.rpc
  );

  const smartAccount = opts.account as Address;
  const entryPoint   = opts.entryPoint as Address;

  // ── 1. Show zero-balance proof ────────────────────────────────────────────
  const balance = await publicClient.getBalance({ address: smartAccount });
  console.log(`\n📱 Smart Account:     ${smartAccount}`);
  console.log(`💰 ADI Balance:        ${balance} wei  ${balance === 0n ? "← ZERO (gas is sponsored!)" : ""}`);
  console.log(`⚡ Entry Point:        ${entryPoint}`);
  console.log(`🎯 Target:             ${opts.to}`);

  // ── 2. Build callData: account.execute(to, value=0, calldata) ─────────────
  const innerCallData = encodeFunctionData({
    abi:          SIMPLE_SMART_ACCOUNT_ABI,
    functionName: "execute",
    args:         [opts.to as Address, 0n, opts.data as Hex],
  });

  // ── 3. Build the UserOperation ────────────────────────────────────────────
  console.log("\n🔨 Building UserOperation...");
  let userOp = await buildUserOp(publicClient, {
    sender:     smartAccount,
    callData:   innerCallData,
    entryPoint,
  });

  // ── 4. Get the userOpHash (without signature, with empty paymasterAndData) ─
  const userOpHash = await getUserOpHash(publicClient, userOp, entryPoint);
  console.log(`   userOpHash: ${userOpHash}`);

  // ── 5. Request sponsor signature ──────────────────────────────────────────
  console.log(`\n✍️  Requesting sponsorship from ${opts.sponsorUrl}...`);
  const sponsorResponse = await fetch(`${opts.sponsorUrl}/sign`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ userOpHash }),
  });

  if (!sponsorResponse.ok) {
    const detail = await sponsorResponse.text();
    throw new Error(`Sponsor service rejected: ${detail}`);
  }

  const { signature: sponsorSig, paymasterAndData } = await sponsorResponse.json() as {
    signature: Hex;
    paymasterAndData: Hex;
  };

  console.log(`   Sponsor sig: ${sponsorSig.slice(0, 18)}...`);
  userOp.paymasterAndData = paymasterAndData;

  // ── 6. Sign the UserOperation with the account owner's key ────────────────
  console.log("\n🔐 Signing UserOperation with account owner key...");
  const finalHash = await getUserOpHash(publicClient, userOp, entryPoint);
  const ownerSig  = await walletClient.signMessage({
    message: { raw: finalHash },
  });
  userOp.signature = ownerSig;
  console.log(`   Owner sig:   ${ownerSig.slice(0, 18)}...`);

  // ── 7. Submit to EntryPoint (acting as self-hosted bundler) ───────────────
  console.log("\n🚀 Submitting to EntryPoint (self-hosted bundler mode)...");
  const txHash = await walletClient.writeContract({
    address:      entryPoint,
    abi:          ENTRY_POINT_ABI,
    functionName: "handleOps",
    args:         [[userOp], signerAccount.address],
  });

  console.log(`\n📤 Tx sent: ${txHash}`);
  console.log("⏳ Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log(`\n✅ UserOperation executed!`);
  console.log(`   Block:    ${receipt.blockNumber}`);
  console.log(`   Gas used: ${receipt.gasUsed}`);
  console.log(`   Explorer: https://explorer.ab.testnet.adifoundation.ai/tx/${txHash}`);
  console.log(`\n🎉 Zero-balance wallet successfully called the target contract!`);
  console.log(`   Gas was paid by the SignaturePaymaster.`);
}
