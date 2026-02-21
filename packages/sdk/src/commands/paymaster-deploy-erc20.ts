import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { makeClients } from "../lib/wallet.js";
import { ERC20_TOKEN_PAYMASTER_ABI } from "../lib/abis.js";
import type { Address } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadBytecode(): `0x${string}` {
  const artifactPath = resolve(
    __dirname,
    "../../../foundry/out/ERC20TokenPaymaster.sol/ERC20TokenPaymaster.json"
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

export interface PaymasterDeployERC20Options {
  privateKey:       string;
  entryPoint:       string;
  sponsorSigner:    string;
  token:            string;
  exchangeRate:     string;
  rpc?:             string;
}

export async function paymasterDeployERC20(opts: PaymasterDeployERC20Options): Promise<void> {
  const { publicClient, walletClient, account } = makeClients(
    opts.privateKey as `0x${string}`,
    opts.rpc
  );

  console.log(`\n  Deployer:        ${account.address}`);
  console.log(`  Entry Point:     ${opts.entryPoint}`);
  console.log(`  Sponsor Signer:  ${opts.sponsorSigner}`);
  console.log(`  ERC20 Token:     ${opts.token}`);
  console.log(`  Exchange Rate:   ${opts.exchangeRate}\n`);

  const bytecode = loadBytecode();

  console.log("  Deploying ERC20TokenPaymaster...");

  const hash = await walletClient.deployContract({
    abi:  ERC20_TOKEN_PAYMASTER_ABI,
    bytecode,
    args: [
      opts.entryPoint    as Address,
      opts.sponsorSigner as Address,
      opts.token         as Address,
      BigInt(opts.exchangeRate),
      account.address,
    ],
  });

  console.log(`  Tx sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error("Deployment failed — no contract address in receipt");
  }

  console.log(`\n  ERC20TokenPaymaster deployed!`);
  console.log(`  Address:  ${receipt.contractAddress}`);
  console.log(`  Explorer: https://explorer.ab.testnet.adifoundation.ai/address/${receipt.contractAddress}`);
}
