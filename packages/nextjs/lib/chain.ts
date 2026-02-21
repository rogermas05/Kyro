import { defineChain } from 'viem'
import { localhost } from 'viem/chains'

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

// Set NEXT_PUBLIC_USE_LOCAL=true in .env.local to use anvil instead of ADI testnet
export const adi = process.env.NEXT_PUBLIC_USE_LOCAL === 'true' ? localhost : adiTestnet
