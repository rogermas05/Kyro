import { defineChain } from 'viem'

export const adi = defineChain({
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
