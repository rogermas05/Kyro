import express from "express";
import {
  type Hex,
  type Address,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  concat,
  pad,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { adiTestnet } from "../lib/chain.js";

/**
 * Compute the sponsor-signed hash:
 *   keccak256("\x19Ethereum Signed Message:\n32" || keccak256(userOpHash || chainId || paymaster))
 */
function buildEthSignedSponsorHash(
  userOpHash: Hex,
  chainId: number,
  paymaster: Address
): Uint8Array {
  // inner hash: keccak256(abi.encodePacked(userOpHash, chainId, paymaster))
  const packed = concat([
    userOpHash,
    pad(toHex(BigInt(chainId)), { size: 32 }),
    paymaster,
  ]);
  const innerHash = keccak256(packed);

  // eth_sign prefix
  const prefix = toBytes("\x19Ethereum Signed Message:\n32");
  return concat([prefix, toBytes(innerHash)]);
}

export interface SponsorSignOptions {
  sponsorKey: string;
  paymaster:  string;
  chainId:    number;
  port:       number;
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

  console.log(`\n✍️  Sponsor Signer: ${account.address}`);
  console.log(`📍 Paymaster:       ${opts.paymaster}`);
  console.log(`🌐 Chain ID:        ${opts.chainId}`);
  console.log(`\n🚀 Sponsor service listening on http://localhost:${opts.port}\n`);

  /**
   * POST /sign
   * Body: { userOpHash: "0x..." }
   * Response: { signature: "0x...", paymasterAndData: "0x..." }
   *
   * The signature covers: keccak256(userOpHash || chainId || paymaster)
   * This is verified on-chain by SignaturePaymaster.validatePaymasterUserOp()
   */
  app.post("/sign", async (req, res) => {
    const { userOpHash } = req.body as { userOpHash?: string };

    if (!userOpHash || !userOpHash.startsWith("0x")) {
      res.status(400).json({ error: "Missing or invalid userOpHash" });
      return;
    }

    try {
      // Sign the combined hash off-chain
      const signature = await walletClient.signMessage({
        message: {
          raw: keccak256(
            concat([
              userOpHash as Hex,
              pad(toHex(BigInt(opts.chainId)), { size: 32 }),
              opts.paymaster as Address,
            ])
          ),
        },
      });

      // Build paymasterAndData: [paymaster 20B][verGasLimit 16B][postOpGasLimit 16B][sig 65B]
      const verGasLimit    = pad(toHex(100_000n), { size: 16 });
      const postOpGasLimit = pad(toHex(50_000n),  { size: 16 });
      const paymasterAndData = concat([
        opts.paymaster as Hex,
        verGasLimit,
        postOpGasLimit,
        signature,
      ]);

      console.log(`  ✅ Signed userOpHash ${userOpHash.slice(0, 12)}...`);
      res.json({ signature, paymasterAndData });
    } catch (err) {
      console.error("  ❌ Signing error:", err);
      res.status(500).json({ error: "Signing failed", detail: String(err) });
    }
  });

  /** GET /health — liveness check */
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", signer: account.address, paymaster: opts.paymaster });
  });

  app.listen(opts.port);
}
