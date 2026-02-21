import { defineChain } from 'viem'

const adiTestnet = defineChain({
  id: 99999,
  name: 'ADI Testnet',
  nativeCurrency: { name: 'ADI', symbol: 'ADI', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.ab.testnet.adifoundation.ai/'] },
  },
  blockExplorers: {
    default: {
      name: 'ADI Explorer',
      url: 'https://explorer.ab.testnet.adifoundation.ai',
    },
  },
  testnet: true,
})

// Anvil's default chain ID is 31337. viem's built-in `localhost` uses 1337 — wrong.
const anvil = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  testnet: true,
})

// Set NEXT_PUBLIC_USE_LOCAL=true in .env.local to use anvil instead of ADI testnet
export const adi = process.env.NEXT_PUBLIC_USE_LOCAL === 'true' ? anvil : adiTestnet
