import { createPublicClient, http, parseUnits } from 'viem'
import { adi } from './chain.js'

const PRICE_ORACLE_ABI = [
  {
    name: 'fiatToToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'fiatAmount', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/**
 * Fetch how many tokenIn units are needed to cover `fiatAmountAED` AED.
 * Calls PriceOracle.fiatToToken() on-chain.
 */
export async function fetchTokenAmount(
  rpcUrl: string,
  oracleAddress: `0x${string}`,
  fiatAmountAED: number,
  tokenIn: `0x${string}`,
): Promise<bigint> {
  const chain = { ...adi, rpcUrls: { default: { http: [rpcUrl] } } }
  const client = createPublicClient({ chain, transport: http(rpcUrl) })
  const fiatWei = parseUnits(String(fiatAmountAED), 18)
  return client.readContract({
    address: oracleAddress,
    abi: PRICE_ORACLE_ABI,
    functionName: 'fiatToToken',
    args: [fiatWei, tokenIn],
  })
}
