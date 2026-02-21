import { makeClients } from "../lib/wallet.js";
import { SIGNATURE_PAYMASTER_ABI, ERC20_TOKEN_PAYMASTER_ABI } from "../lib/abis.js";
import type { Address } from "viem";

export interface PaymasterConfigureOptions {
  privateKey:     string;
  paymaster:      string;
  sponsorSigner?: string;
  exchangeRate?:  string;
  rpc?:           string;
}

export async function paymasterConfigure(opts: PaymasterConfigureOptions): Promise<void> {
  const { publicClient, walletClient } = makeClients(
    opts.privateKey as `0x${string}`,
    opts.rpc
  );

  const paymaster = opts.paymaster as Address;

  if (opts.sponsorSigner) {
    console.log(`  Setting sponsor signer to ${opts.sponsorSigner}...`);
    const hash = await walletClient.writeContract({
      address: paymaster,
      abi: SIGNATURE_PAYMASTER_ABI,
      functionName: "setSponsorSigner",
      args: [opts.sponsorSigner as Address],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  Done (block ${receipt.blockNumber})`);
  }

  if (opts.exchangeRate) {
    console.log(`  Setting exchange rate to ${opts.exchangeRate}...`);
    const hash = await walletClient.writeContract({
      address: paymaster,
      abi: ERC20_TOKEN_PAYMASTER_ABI,
      functionName: "setExchangeRate",
      args: [BigInt(opts.exchangeRate)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  Done (block ${receipt.blockNumber})`);
  }

  console.log("  Configuration complete.");
}
