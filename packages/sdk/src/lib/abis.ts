// Inline ABIs for the ADI AA contracts.
// These mirror the Solidity definitions in packages/foundry/src/aa/.

export const SIGNATURE_PAYMASTER_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "_entryPoint",    type: "address" },
      { name: "_sponsorSigner", type: "address" },
      { name: "owner_",         type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getDeposit",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setSponsorSigner",
    inputs: [{ name: "newSigner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "validatePaymasterUserOp",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        components: [
          { name: "sender",             type: "address" },
          { name: "nonce",              type: "uint256" },
          { name: "initCode",           type: "bytes"   },
          { name: "callData",           type: "bytes"   },
          { name: "accountGasLimits",   type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees",            type: "bytes32" },
          { name: "paymasterAndData",   type: "bytes"   },
          { name: "signature",          type: "bytes"   },
        ],
      },
      { name: "userOpHash", type: "bytes32" },
      { name: "maxCost",    type: "uint256" },
    ],
    outputs: [
      { name: "context",        type: "bytes"   },
      { name: "validationData", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "entryPoint",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sponsorSigner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

export const ENTRY_POINT_ABI = [
  {
    type: "function",
    name: "handleOps",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender",             type: "address" },
          { name: "nonce",              type: "uint256" },
          { name: "initCode",           type: "bytes"   },
          { name: "callData",           type: "bytes"   },
          { name: "accountGasLimits",   type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees",            type: "bytes32" },
          { name: "paymasterAndData",   type: "bytes"   },
          { name: "signature",          type: "bytes"   },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getNonce",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key",    type: "uint192" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserOpHash",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        components: [
          { name: "sender",             type: "address" },
          { name: "nonce",              type: "uint256" },
          { name: "initCode",           type: "bytes"   },
          { name: "callData",           type: "bytes"   },
          { name: "accountGasLimits",   type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees",            type: "bytes32" },
          { name: "paymasterAndData",   type: "bytes"   },
          { name: "signature",          type: "bytes"   },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "depositTo",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const SIMPLE_SMART_ACCOUNT_ABI = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value",  type: "uint256" },
      { name: "data",   type: "bytes"   },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

export const SMART_ACCOUNT_FACTORY_ABI = [
  {
    type: "constructor",
    inputs: [{ name: "_entryPoint", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createAccount",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt",  type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getAddress",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt",  type: "uint256" },
    ],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;
