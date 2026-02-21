// Minimal ABIs — only the functions + events used by the frontend.

export const ORCHESTRATOR_ABI = [
  {
    name: 'mintInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'invoiceId',    type: 'bytes32' },
      { name: 'faceValue',    type: 'uint256' },
      { name: 'dueDate',      type: 'uint64'  },
      { name: 'documentHash', type: 'bytes32' },
      { name: 'counterparty', type: 'address' },
      { name: 'zkProof',      type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'InvoiceMinted',
    type: 'event',
    inputs: [
      { name: 'invoiceId',    type: 'bytes32', indexed: true  },
      { name: 'sme',          type: 'address', indexed: true  },
      { name: 'faceValue',    type: 'uint256', indexed: false },
      { name: 'seniorAmount', type: 'uint256', indexed: false },
      { name: 'juniorAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'InvoiceSettled',
    type: 'event',
    inputs: [
      { name: 'invoiceId',  type: 'bytes32', indexed: true  },
      { name: 'ddscRepaid', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'InvoiceDefaulted',
    type: 'event',
    inputs: [
      { name: 'invoiceId',       type: 'bytes32', indexed: true  },
      { name: 'recoveredAmount', type: 'uint256', indexed: false },
    ],
  },
] as const

export const VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets',   type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'redeem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares',   type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner',    type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'convertToAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const ORACLE_ABI = [
  {
    name: 'fiatToToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'fiatAmount', type: 'uint256' },
      { name: 'token',      type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const ROUTER_ABI = [
  {
    name: 'checkout',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'merchant',     type: 'address' },
      { name: 'fiatAmount',   type: 'uint256' },
      { name: 'tokenIn',      type: 'address' },
      { name: 'targetToken',  type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'previewCheckout',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'fiatAmount', type: 'uint256' },
      { name: 'tokenIn',    type: 'address' },
    ],
    outputs: [{ name: 'tokenInAmount', type: 'uint256' }],
  },
] as const
