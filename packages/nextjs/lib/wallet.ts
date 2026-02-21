import { createPublicClient, createWalletClient, custom, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { adi } from './chain'

type Ethereum = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
type EIP6963Detail = { info: { rdns: string }; provider: Ethereum }

// Stored when the user connects — reused by getWalletClient() synchronously.
let _provider: Ethereum | null = null

/** Use EIP-6963 to find MetaMask specifically, falling back to window.ethereum. */
async function getMetaMask(): Promise<Ethereum> {
  return new Promise(resolve => {
    const found: EIP6963Detail[] = []
    const handler = (e: Event) => found.push((e as CustomEvent<EIP6963Detail>).detail)
    window.addEventListener('eip6963:announceProvider', handler)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handler)
      const mm = found.find(p => p.info.rdns === 'io.metamask')
      if (mm) { resolve(mm.provider); return }
      // Fall back to window.ethereum (single-wallet case)
      const win = window as Window & { ethereum?: Ethereum }
      if (!win.ethereum) throw new Error('MetaMask not found. Please install MetaMask.')
      resolve(win.ethereum)
    }, 100)
  })
}

function getEthereum(): Ethereum {
  if (_provider) return _provider
  // Synchronous fallback (used by getWalletClient before connectWallet is called)
  const win = window as Window & { ethereum?: Ethereum }
  if (!win.ethereum) throw new Error('No wallet found. Please install MetaMask.')
  return win.ethereum
}

/** Switch MetaMask to the correct chain.
 *  - Anvil (31337): MetaMask has this built-in as "Localhost 8545", so just switch.
 *  - ADI Testnet (99999): custom chain — add it first if not present, then switch. */
async function switchToADI(ethereum: Ethereum): Promise<void> {
  const chainIdHex = '0x' + adi.id.toString(16)

  if (adi.id === 31337) {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
    return
  }

  await ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: chainIdHex,
      chainName: adi.name,
      nativeCurrency: adi.nativeCurrency,
      rpcUrls: adi.rpcUrls.default.http,
      blockExplorerUrls: adi.blockExplorers
        ? [adi.blockExplorers.default.url]
        : [],
    }],
  })
}

// ── Browser wallet (Rabby / MetaMask) ────────────────────────────────────────

export async function connectWallet(): Promise<`0x${string}`> {
  const ethereum = await getMetaMask()
  _provider = ethereum
  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[]
  await switchToADI(ethereum)
  const account = accounts[0] as `0x${string}`

  // On local Anvil: sync Anvil's nonce to match whatever the browser wallet
  // thinks the next nonce is (it adds locally-stuck pending txs on top of the
  // chain nonce after an Anvil restart).
  if (adi.id === 31337) {
    const pendingHex = await ethereum.request({
      method: 'eth_getTransactionCount',
      params: [account, 'pending'],
    }) as string
    const pendingNonce = parseInt(pendingHex, 16)
    if (pendingNonce > 0) {
      await fetch('/api/fix-nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: account, nonce: pendingNonce }),
      }).catch(() => { /* non-fatal */ })
    }
  }

  return account
}

// ── Private-key wallet (local Anvil test accounts) ────────────────────────────

// Module-level: set when user picks a test account. Cleared on page reload.
let _activeKey: `0x${string}` | null = null

/** Connect using a raw private key (Anvil test accounts only).
 *  Returns the derived address. Bypasses browser wallet entirely. */
export function connectWithKey(privateKey: `0x${string}`): `0x${string}` {
  _activeKey = privateKey
  return privateKeyToAccount(privateKey).address
}

/** Clear the active private-key session (local mode disconnect). */
export function disconnectWallet(): void {
  _activeKey = null
}

export function getPublicClient() {
  return createPublicClient({ chain: adi, transport: http() })
}

export function getWalletClient(account: `0x${string}`) {
  if (_activeKey) {
    // Private-key mode: sign locally, send directly to Anvil via HTTP
    return createWalletClient({
      account: privateKeyToAccount(_activeKey),
      chain: adi,
      transport: http(),
    })
  }
  // Browser wallet mode
  return createWalletClient({ account, chain: adi, transport: custom(getEthereum()) })
}

// Well-known Anvil test accounts (mnemonic: "test test … junk").
// Accounts 0-2 are used by the deploy scripts (deployer, paymaster, oracle).
export const ANVIL_ACCOUNTS = [
  { label: 'Anvil #3', address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as `0x${string}`, key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as `0x${string}` },
  { label: 'Anvil #4', address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as `0x${string}`, key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926b' as `0x${string}` },
  { label: 'Anvil #5', address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' as `0x${string}`, key: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as `0x${string}` },
] as const
