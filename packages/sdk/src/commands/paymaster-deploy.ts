import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { makeClients } from "../lib/wallet.js";
import { SIGNATURE_PAYMASTER_ABI } from "../lib/abis.js";
import type { Address } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load SignaturePaymaster bytecode from Foundry build artifacts.
 * Looks in ../../foundry/out relative to the SDK package.
 */
function loadBytecode(): `0x${string}` {
  const artifactPath = resolve(
    __dirname,
    "../../../foundry/out/SignaturePaymaster.sol/SignaturePaymaster.json"
  );

  if (!existsSync(artifactPath)) {
    throw new Error(
      `Foundry artifact not found at ${artifactPath}.\n` +
      `Run: forge build --root packages/foundry`
    );
  }

  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return artifact.bytecode.object as `0x${string}`;
}

export interface PaymasterDeployOptions {
  privateKey:    string;
  entryPoint:    string;
  sponsorSigner: string;
  rpc?:          string;
}

export async function paymasterDeploy(opts: PaymasterDeployOptions): Promise<void> {
  const { publicClient, walletClient, account } = makeClients(
    opts.privateKey as `0x${string}`,
    opts.rpc
  );

  console.log(`\n🔑 Deployer:       ${account.address}`);
  console.log(`⚡ Entry Point:     ${opts.entryPoint}`);
  console.log(`✍️  Sponsor Signer:  ${opts.sponsorSigner}`);
  console.log(`🌐 Network:         ADI Testnet (Chain ID 99999)\n`);

  const bytecode = loadBytecode();

  console.log("📦 Deploying SignaturePaymaster...");

  const hash = await walletClient.deployContract({
    abi:  SIGNATURE_PAYMASTER_ABI,
    bytecode,
    args: [
      opts.entryPoint    as Address,
      opts.sponsorSigner as Address,
      account.address,
    ],
  });

  console.log(`📤 Tx sent: ${hash}`);
  console.log("⏳ Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error("Deployment failed — no contract address in receipt");
  }

  console.log(`\n✅ SignaturePaymaster deployed!`);
  console.log(`   Address:  ${receipt.contractAddress}`);
  console.log(`   Explorer: https://explorer.ab.testnet.adifoundation.ai/address/${receipt.contractAddress}`);
  console.log(`\n💡 Next step: fund the paymaster deposit`);
  console.log(`   adig paymaster:fund --paymaster ${receipt.contractAddress} --amount 0.1`);
}
