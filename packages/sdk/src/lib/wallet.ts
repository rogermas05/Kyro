import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { adiTestnet } from "./chain.js";

export function makeClients(privateKey: `0x${string}`, rpcUrl?: string) {
  const chain: Chain = rpcUrl
    ? { ...adiTestnet, rpcUrls: { default: { http: [rpcUrl] } } }
    : adiTestnet;

  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl ?? adiTestnet.rpcUrls.default.http[0]),
  });

  const walletClient = createWalletClient({
    chain,
    transport: http(rpcUrl ?? adiTestnet.rpcUrls.default.http[0]),
    account,
  });

  return { publicClient, walletClient, account, chain };
}
