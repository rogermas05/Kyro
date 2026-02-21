#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { paymasterDeploy }       from "./commands/paymaster-deploy.js";
import { paymasterDeployERC20 }  from "./commands/paymaster-deploy-erc20.js";
import { paymasterConfigure }    from "./commands/paymaster-configure.js";
import { paymasterFund }         from "./commands/paymaster-fund.js";
import { sponsorSign }           from "./commands/sponsor-sign.js";
import { sendUserOp }            from "./commands/send-userop.js";

const program = new Command();

program
  .name("adig")
  .description("ADI-Gas SDK — ERC-4337 Paymaster toolkit for ADI Chain")
  .version("0.2.0");

// ── paymaster:deploy ──────────────────────────────────────────────────────────
program
  .command("paymaster:deploy")
  .description("Deploy native-token SignaturePaymaster")
  .requiredOption("--private-key <key>",    "Deployer private key (0x...)", process.env.PRIVATE_KEY)
  .requiredOption("--entry-point <addr>",   "EntryPoint v0.7 contract address")
  .requiredOption("--sponsor-signer <addr>","Address whose key will run adig sponsor:sign")
  .option("--rpc <url>",                    "RPC URL", process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await paymasterDeploy({
      privateKey:    opts.privateKey,
      entryPoint:    opts.entryPoint,
      sponsorSigner: opts.sponsorSigner,
      rpc:           opts.rpc,
    });
  });

// ── paymaster:deploy-erc20 ───────────────────────────────────────────────────
program
  .command("paymaster:deploy-erc20")
  .description("Deploy ERC20TokenPaymaster (collects gas payment in ERC20)")
  .requiredOption("--private-key <key>",    "Deployer private key", process.env.PRIVATE_KEY)
  .requiredOption("--entry-point <addr>",   "EntryPoint v0.7 contract address")
  .requiredOption("--sponsor-signer <addr>","Sponsor signer address")
  .requiredOption("--token <addr>",         "ERC20 token address for gas payment")
  .requiredOption("--exchange-rate <wei>",  "Token-wei per native-wei (scaled 1e18)")
  .option("--rpc <url>",                    "RPC URL", process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await paymasterDeployERC20({
      privateKey:    opts.privateKey,
      entryPoint:    opts.entryPoint,
      sponsorSigner: opts.sponsorSigner,
      token:         opts.token,
      exchangeRate:  opts.exchangeRate,
      rpc:           opts.rpc,
    });
  });

// ── paymaster:configure ──────────────────────────────────────────────────────
program
  .command("paymaster:configure")
  .description("Update paymaster settings (sponsor signer, exchange rate)")
  .requiredOption("--private-key <key>",    "Owner private key", process.env.PRIVATE_KEY)
  .requiredOption("--paymaster <addr>",     "Paymaster contract address")
  .option("--sponsor-signer <addr>",        "New sponsor signer address")
  .option("--exchange-rate <wei>",          "New exchange rate (ERC20 paymaster only)")
  .option("--rpc <url>",                    "RPC URL", process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await paymasterConfigure({
      privateKey:    opts.privateKey,
      paymaster:     opts.paymaster,
      sponsorSigner: opts.sponsorSigner,
      exchangeRate:  opts.exchangeRate,
      rpc:           opts.rpc,
    });
  });

// ── paymaster:fund ───────────────────────────────────────────────────────────
program
  .command("paymaster:fund")
  .description("Deposit native tokens into paymaster's EntryPoint balance")
  .requiredOption("--private-key <key>",    "Funder private key", process.env.PRIVATE_KEY)
  .requiredOption("--paymaster <addr>",     "Paymaster contract address")
  .requiredOption("--amount <ether>",       "Amount in ADI (e.g. 0.5)")
  .option("--rpc <url>",                    "RPC URL", process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await paymasterFund({
      privateKey: opts.privateKey,
      paymaster:  opts.paymaster,
      amount:     opts.amount,
      rpc:        opts.rpc,
    });
  });

// ── sponsor:sign ──────────────────────────────────────────────────────────────
program
  .command("sponsor:sign")
  .description("Run the sponsor signing service for UserOperation sponsorship")
  .requiredOption("--sponsor-key <key>",  "Sponsor private key (0x...)", process.env.SPONSOR_PRIVATE_KEY)
  .requiredOption("--paymaster <addr>",   "Deployed paymaster address")
  .requiredOption("--entry-point <addr>", "EntryPoint contract address")
  .option("--chain-id <id>",              "Chain ID",           "99999")
  .option("--port <number>",             "HTTP server port",   "3001")
  .option("--validity-seconds <secs>",   "Sponsorship validity window", "300")
  .option("--rpc <url>",                 "RPC URL",            process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await sponsorSign({
      sponsorKey:      opts.sponsorKey,
      paymaster:       opts.paymaster,
      entryPoint:      opts.entryPoint,
      chainId:         parseInt(opts.chainId, 10),
      port:            parseInt(opts.port, 10),
      validitySeconds: parseInt(opts.validitySeconds, 10),
      rpc:             opts.rpc,
    });
  });

// ── send:userop ───────────────────────────────────────────────────────────────
program
  .command("send:userop")
  .description("Build, sponsor, and submit a UserOperation")
  .requiredOption("--owner-key <key>",    "Smart account owner private key", process.env.PRIVATE_KEY)
  .requiredOption("--account <addr>",     "Smart account address")
  .requiredOption("--entry-point <addr>", "EntryPoint contract address")
  .requiredOption("--to <addr>",          "Target contract to call")
  .requiredOption("--data <hex>",         "Calldata for the target call")
  .option("--sponsor-url <url>",          "Sponsor service URL",  "http://localhost:3001")
  .option("--paymaster-type <type>",      "native or erc20",     "native")
  .option("--max-token-cost <wei>",       "Max ERC20 cost (for erc20 type)")
  .option("--rpc <url>",                  "RPC URL",             process.env.ADI_RPC_URL)
  .action(async (opts) => {
    await sendUserOp({
      ownerKey:      opts.ownerKey,
      account:       opts.account,
      entryPoint:    opts.entryPoint,
      to:            opts.to,
      data:          opts.data,
      sponsorUrl:    opts.sponsorUrl,
      paymasterType: opts.paymasterType,
      maxTokenCost:  opts.maxTokenCost,
      rpc:           opts.rpc,
    });
  });

program.parse();
