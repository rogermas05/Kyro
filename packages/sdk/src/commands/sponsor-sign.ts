import express from "express";
import {
  type Hex,
  type Address,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { adiTestnet } from "../lib/chain.js";
import {
  computePaymasterHash,
  computeERC20PaymasterHash,
  buildNativePaymasterAndData,
  buildERC20PaymasterAndData,
  type PackedUserOperation,
} from "../lib/userop.js";

export interface SponsorSignOptions {
  sponsorKey: string;
  paymaster:  string;
  chainId:    number;
  port:       number;
  entryPoint: string;
  validitySeconds: number;
  rpc?:       string;
}

export async function sponsorSign(opts: SponsorSignOptions): Promise<void> {
  const account = privateKeyToAccount(opts.sponsorKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: adiTestnet,
    transport: http(opts.rpc ?? adiTestnet.rpcUrls.default.http[0]),
  });

  const app = express();
  app.use(express.json());

  console.log(`\n  Sponsor Signer: ${account.address}`);
  console.log(`  Paymaster:       ${opts.paymaster}`);
  console.log(`  EntryPoint:      ${opts.entryPoint}`);
  console.log(`  Chain ID:        ${opts.chainId}`);
  console.log(`  Validity:        ${opts.validitySeconds}s`);
  console.log(`\n  Sponsor service listening on http://localhost:${opts.port}\n`);

  /**
   * POST /sign
   * Body: { userOp: PackedUserOperation, paymasterType?: "native" | "erc20", maxTokenCost?: string }
   * Response: { paymasterAndData, validUntil, validAfter }
   */
  app.post("/sign", async (req, res) => {
    const { userOp, paymasterType = "native", maxTokenCost } = req.body as {
      userOp?: PackedUserOperation;
      paymasterType?: "native" | "erc20";
      maxTokenCost?: string;
    };

    if (!userOp || !userOp.sender) {
      res.status(400).json({ error: "Missing userOp" });
      return;
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now;
      const validUntil = now + opts.validitySeconds;

      let hash: Hex;
      let paymasterAndData: Hex;

      if (paymasterType === "erc20" && maxTokenCost) {
        hash = computeERC20PaymasterHash(
          userOp,
          opts.chainId,
          opts.entryPoint as Address,
          opts.paymaster as Address,
          validUntil,
          validAfter,
          BigInt(maxTokenCost)
        );

        const signature = await walletClient.signMessage({
          message: { raw: hash },
        });

        paymasterAndData = buildERC20PaymasterAndData(
          opts.paymaster as Address,
          validUntil,
          validAfter,
          BigInt(maxTokenCost),
          signature
        );
      } else {
        hash = computePaymasterHash(
          userOp,
          opts.chainId,
          opts.entryPoint as Address,
          opts.paymaster as Address,
          validUntil,
          validAfter
        );

        const signature = await walletClient.signMessage({
          message: { raw: hash },
        });

        paymasterAndData = buildNativePaymasterAndData(
          opts.paymaster as Address,
          validUntil,
          validAfter,
          signature
        );
      }

      console.log(`  Signed for ${userOp.sender.slice(0, 12)}... [${paymasterType}]`);
      res.json({ paymasterAndData, validUntil, validAfter });
    } catch (err) {
      console.error("  Signing error:", err);
      res.status(500).json({ error: "Signing failed", detail: String(err) });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", signer: account.address, paymaster: opts.paymaster });
  });

  app.listen(opts.port);
}
