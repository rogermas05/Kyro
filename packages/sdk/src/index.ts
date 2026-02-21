#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { paymasterDeploy }  from "./commands/paymaster-deploy.js";
import { sponsorSign }      from "./commands/sponsor-sign.js";
import { sendUserOp }       from "./commands/send-userop.js";

const program = new Command();

program
  .name("adig")
  .description("ADI-Gas SDK — ERC-4337 Paymaster toolkit for ADI Chain")
  .version("0.1.0");

// ── paymaster:deploy ──────────────────────────────────────────────────────────
program
  .command("paymaster:deploy")
  .description("Deploy SignaturePaymaster to ADI testnet")
  .requiredOption("--private-key <key>",    "Deployer private key (0x...)", process.env.PRIVATE_KEY)
  .requiredOption("--entry-point <addr>",   "EntryPoint v0.7 contract address")
  .requiredOption("--sponsor-signer <addr>","Address whose key will run adig sponsor:sign")
  .option("--rpc <url>",                    "RPC URL (defaults to ADI testnet)", process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await paymasterDeploy({
      privateKey:    opts.privateKey,
      entryPoint:    opts.entryPoint,
      sponsorSigner: opts.sponsorSigner,
      rpc:           opts.rpc,
    });
  });

// ── sponsor:sign ──────────────────────────────────────────────────────────────
program
  .command("sponsor:sign")
  .description("Run the sponsor service — signs UserOperations so zero-balance wallets can transact")
  .requiredOption("--sponsor-key <key>",  "Sponsor private key (0x...)",              process.env.SPONSOR_PRIVATE_KEY)
  .requiredOption("--paymaster <addr>",   "Deployed SignaturePaymaster address")
  .option("--chain-id <id>",              "Chain ID",                                  "99999")
  .option("--port <number>",              "Port for the HTTP signing server",           "3001")
  .option("--rpc <url>",                  "RPC URL",                                   process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await sponsorSign({
      sponsorKey: opts.sponsorKey,
      paymaster:  opts.paymaster,
      chainId:    parseInt(opts.chainId, 10),
      port:       parseInt(opts.port, 10),
      rpc:        opts.rpc,
    });
  });

// ── send:userop ───────────────────────────────────────────────────────────────
program
  .command("send:userop")
  .description("Build, sponsor, and submit a UserOperation — proves a zero-balance wallet can transact")
  .requiredOption("--owner-key <key>",    "Smart account owner private key (0x...)", process.env.PRIVATE_KEY)
  .requiredOption("--account <addr>",     "Smart account (SimpleSmartAccount) address")
  .requiredOption("--entry-point <addr>", "EntryPoint v0.7 contract address")
  .requiredOption("--to <addr>",          "Target contract to call")
  .requiredOption("--data <hex>",         "Calldata for the target call (hex)")
  .option("--sponsor-url <url>",          "URL of the sponsor service",               "http://localhost:3001")
  .option("--rpc <url>",                  "RPC URL",                                  process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await sendUserOp({
      ownerKey:   opts.ownerKey,
      account:    opts.account,
      entryPoint: opts.entryPoint,
      to:         opts.to,
      data:       opts.data,
      sponsorUrl: opts.sponsorUrl,
      rpc:        opts.rpc,
    });
  });

program.parse();
