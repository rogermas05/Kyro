import { createPublicClient, createWalletClient, custom, http } from 'viem'
import { adi } from './chain'

type Ethereum = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

function getEthereum(): Ethereum {
  const win = window as Window & { ethereum?: Ethereum }
  if (!win.ethereum) throw new Error('No wallet found. Please install MetaMask.')
  return win.ethereum
}

export async function connectWallet(): Promise<`0x${string}`> {
  const ethereum = getEthereum()
  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[]
  return accounts[0] as `0x${string}`
}

export function getPublicClient() {
  return createPublicClient({ chain: adi, transport: http() })
}

export function getWalletClient(account: `0x${string}`) {
  return createWalletClient({ account, chain: adi, transport: custom(getEthereum()) })
}
