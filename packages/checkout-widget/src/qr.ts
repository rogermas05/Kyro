import QRCode from 'qrcode'

/**
 * Payload encoded in the QR code.
 * Mobile wallets scan this and pre-fill the checkout() call.
 */
export interface CheckoutPayload {
  type: 'adi-pay'
  version: '1'
  chainId: number
  router: string        // ADIPayRouter contract address
  merchant: string      // merchant wallet that receives targetToken
  fiatAmount: string    // BigInt string (AED, 18 decimals) e.g. "500000000000000000000"
  tokenIn: string       // ERC-20 the customer pays with
  targetToken: string   // ERC-20 the merchant wants to receive
}

/**
 * Encode a CheckoutPayload into a base64 PNG data-URL for embedding as <img src>.
 */
export async function generateQR(payload: CheckoutPayload): Promise<string> {
  const data = JSON.stringify(payload)
  return QRCode.toDataURL(data, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
}
