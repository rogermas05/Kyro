import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseUnits,
  formatUnits,
} from 'viem'
import { adi } from './chain.js'
import { fetchTokenAmount } from './oracle.js'
import { generateQR } from './qr.js'

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const ROUTER_ABI = [
  {
    name: 'checkout',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'fiatAmount', type: 'uint256' },
      { name: 'tokenIn', type: 'address' },
      { name: 'targetToken', type: 'address' },
    ],
    outputs: [],
  },
] as const

// ── Config ────────────────────────────────────────────────────────────────────

export interface ADIPayConfig {
  /** Purchase price in AED, human-readable (e.g. 500 = 500 AED). */
  amount: number
  /** Merchant wallet — receives targetToken after checkout. */
  merchant: `0x${string}`
  /** ERC-20 token the customer pays with (e.g. DDSC or mADI address). */
  tokenIn: `0x${string}`
  /** ERC-20 token the merchant wants to receive. */
  targetToken: `0x${string}`
  /** Deployed ADIPayRouter contract address. */
  routerAddress: `0x${string}`
  /** Deployed PriceOracle contract address. */
  oracleAddress: `0x${string}`
  /** ADI testnet RPC. Defaults to the public endpoint. */
  rpcUrl?: string
  /** Called with the checkout tx hash on success. */
  onSuccess?: (txHash: `0x${string}`) => void
  /** Called with the error on failure. */
  onError?: (error: Error) => void
}

// ── Main class ────────────────────────────────────────────────────────────────

export class ADIPay {
  private cfg: ADIPayConfig
  private rpcUrl: string

  constructor(config: ADIPayConfig) {
    this.cfg = config
    this.rpcUrl = config.rpcUrl ?? 'https://rpc.ab.testnet.adifoundation.ai/'
  }

  // ── Public helpers ──────────────────────────────────────────────────────────

  /** Returns how many tokenIn wei the customer will be charged. */
  async previewAmount(): Promise<bigint> {
    return fetchTokenAmount(
      this.rpcUrl,
      this.cfg.oracleAddress,
      this.cfg.amount,
      this.cfg.tokenIn,
    )
  }

  // ── render() ────────────────────────────────────────────────────────────────

  /**
   * Inject a "Pay X AED" button into `selector`.
   * On click: connect wallet → approve tokenIn → call checkout().
   */
  async render(selector: string): Promise<void> {
    const el = document.querySelector(selector)
    if (!el) throw new Error(`ADIPay: element "${selector}" not found`)

    // Pre-fetch displayed amount (best-effort; silent fail shows 0)
    let displayAmount = '…'
    try {
      const amt = await this.previewAmount()
      displayAmount = `${formatUnits(amt, 18)} tokens`
    } catch {
      displayAmount = `${this.cfg.amount} AED`
    }

    const btn = document.createElement('button')
    btn.textContent = `Pay ${this.cfg.amount} AED (≈ ${displayAmount})`
    Object.assign(btn.style, {
      background: '#0066FF',
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      padding: '12px 24px',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      width: '100%',
      fontFamily: 'sans-serif',
    })

    btn.addEventListener('click', () => this._handlePayment(btn))
    el.appendChild(btn)
  }

  // ── renderQR() ──────────────────────────────────────────────────────────────

  /**
   * Inject a QR code into `selector`.
   * The QR encodes the checkout payload as JSON for mobile wallets.
   */
  async renderQR(selector: string): Promise<void> {
    const el = document.querySelector(selector)
    if (!el) throw new Error(`ADIPay: element "${selector}" not found`)

    const fiatWei = parseUnits(String(this.cfg.amount), 18)

    const dataUrl = await generateQR({
      type: 'adi-pay',
      version: '1',
      chainId: 99999,
      router: this.cfg.routerAddress,
      merchant: this.cfg.merchant,
      fiatAmount: fiatWei.toString(),
      tokenIn: this.cfg.tokenIn,
      targetToken: this.cfg.targetToken,
    })

    const wrapper = document.createElement('div')
    Object.assign(wrapper.style, {
      display: 'inline-block',
      textAlign: 'center',
      fontFamily: 'sans-serif',
    })

    const img = document.createElement('img')
    img.src = dataUrl
    img.alt = `ADIPay QR — ${this.cfg.amount} AED`
    img.style.cssText = 'width:256px;height:256px;display:block;'

    const label = document.createElement('p')
    label.textContent = `Scan to pay ${this.cfg.amount} AED`
    Object.assign(label.style, { margin: '8px 0 0', fontSize: '14px', color: '#333' })

    wrapper.appendChild(img)
    wrapper.appendChild(label)
    el.appendChild(wrapper)
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _handlePayment(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true
    const restore = (text: string, bg = '#CC0000') => {
      btn.textContent = text
      btn.style.background = bg
      btn.disabled = false
    }

    try {
      // 1. Connect wallet (EIP-1193)
      const win = window as Window & { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }
      if (!win.ethereum) throw new Error('No wallet detected. Please install MetaMask.')

      btn.textContent = 'Connecting wallet…'
      const accounts = await win.ethereum.request({ method: 'eth_requestAccounts' })
      const account = accounts[0] as `0x${string}`

      const chain = { ...adi, rpcUrls: { default: { http: [this.rpcUrl] } } }

      const walletClient = createWalletClient({
        account,
        chain,
        transport: custom(win.ethereum),
      })
      const pubClient = createPublicClient({ chain, transport: http(this.rpcUrl) })

      // 2. Fetch exact token amount from oracle
      btn.textContent = 'Fetching price…'
      const tokenAmount = await this.previewAmount()

      // 3. Approve router to spend tokenIn
      btn.textContent = 'Approving token…'
      const approveHash = await walletClient.writeContract({
        address: this.cfg.tokenIn,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [this.cfg.routerAddress, tokenAmount],
      })
      await pubClient.waitForTransactionReceipt({ hash: approveHash })

      // 4. Execute checkout
      btn.textContent = 'Processing payment…'
      const fiatWei = parseUnits(String(this.cfg.amount), 18)
      const checkoutHash = await walletClient.writeContract({
        address: this.cfg.routerAddress,
        abi: ROUTER_ABI,
        functionName: 'checkout',
        args: [this.cfg.merchant, fiatWei, this.cfg.tokenIn, this.cfg.targetToken],
      })
      await pubClient.waitForTransactionReceipt({ hash: checkoutHash })

      // 5. Done
      btn.textContent = '✓ Payment complete!'
      btn.style.background = '#00AA44'
      this.cfg.onSuccess?.(checkoutHash)
    } catch (err) {
      restore('Payment failed — try again')
      this.cfg.onError?.(err as Error)
      console.error('[ADIPay]', err)
    }
  }
}
