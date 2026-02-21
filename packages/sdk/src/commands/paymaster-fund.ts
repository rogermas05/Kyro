import { parseEther } from "viem";
import { makeClients } from "../lib/wallet.js";
import { SIGNATURE_PAYMASTER_ABI } from "../lib/abis.js";
import type { Address } from "viem";

export interface PaymasterFundOptions {
  privateKey: string;
  paymaster:  string;
  amount:     string;
  rpc?:       string;
}

export async function paymasterFund(opts: PaymasterFundOptions): Promise<void> {
  const { publicClient, walletClient } = makeClients(
    opts.privateKey as `0x${string}`,
    opts.rpc
  );

  const paymaster = opts.paymaster as Address;
  const amount = parseEther(opts.amount);

  const depositBefore = await publicClient.readContract({
    address: paymaster,
    abi: SIGNATURE_PAYMASTER_ABI,
    functionName: "getDeposit",
  }) as bigint;

  console.log(`  Paymaster:       ${paymaster}`);
  console.log(`  Deposit before:  ${depositBefore} wei`);
  console.log(`  Depositing:      ${opts.amount} ADI (${amount} wei)`);

  const hash = await walletClient.writeContract({
    address: paymaster,
    abi: SIGNATURE_PAYMASTER_ABI,
    functionName: "deposit",
    value: amount,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const depositAfter = await publicClient.readContract({
    address: paymaster,
    abi: SIGNATURE_PAYMASTER_ABI,
    functionName: "getDeposit",
  }) as bigint;

  console.log(`  Deposit after:   ${depositAfter} wei`);
  console.log(`  Tx:              ${hash}`);
  console.log(`  Block:           ${receipt.blockNumber}`);
}
