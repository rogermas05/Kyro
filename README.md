# Kyro — Invoice Finance, On-Chain

> Instant liquidity for SMEs. Real yield for investors. Full compliance, on ADI Chain.

Kyro is a trade finance protocol that turns outstanding invoices into liquid, on-chain financial instruments. SMEs upload an invoice and receive stablecoin (DDSC) immediately — no 30-day wait, no banks. Investors deposit into a yield-bearing vault and earn returns as those invoices are repaid by buyers. Every step is transparent and auditable on-chain.

---

## How It Works

```
SME uploads invoice
       │
       ▼
Oracle attests (creditworthiness check)
       │
       ▼
Invoice minted as NFT on ADI Chain
80% → Vault (Senior Tranche)   20% → SME (Junior Tranche)
       │
       ▼
SME receives DDSC immediately
       │
       ▼  (30–90 days later)
Buyer repays → Vault settles → Share price rises
       │
       ▼
Investor redeems shares at higher price = yield earned
```

---

## Architecture

| Layer | Technology |
|---|---|
| Blockchain | ADI Chain (Testnet, Chain ID 99999) |
| Smart Contracts | Solidity 0.8.24 + Foundry |
| Token Standards | ERC-721 (Invoice NFT), ERC-4626 (Yield Vault), ERC-3643 (RWA Compliance), ERC-4337 (Account Abstraction) |
| Compliance | KYC gating on all transfers via IdentityRegistry |
| Oracle | Server-side ECDSA signing (ZK attestation model) |
| Frontend | Next.js 14 + TypeScript + Viem |
| AI | Claude (Anthropic) — auto-parses uploaded invoice documents |

### Smart Contract Overview

```
IdentityRegistry      — KYC gating: all transfers require isVerified()
InvoiceOrchestrator   — Invoice lifecycle manager (mint → fund → settle/default)
TradeFinanceVault     — ERC-4626 yield vault (accepts DDSC, issues KYRO shares)
InvoiceToken          — ERC-721 NFT anchoring the invoice on-chain
SeniorToken           — ERC-20 senior tranche (80% face value, vault priority)
JuniorToken           — ERC-20 junior tranche (20% face value, absorbs losses)
InvoiceZKVerifier     — Verifies oracle ECDSA attestations
SimpleSmartAccount    — ERC-4337 smart account for gas-abstracted SME onboarding
```

---

## Portals

| Portal | Who | What |
|---|---|---|
| `/sme` | Business owners | Upload invoice → get DDSC instantly |
| `/investor` | Capital providers | Deposit DDSC → earn yield from real invoices |
| `/auditor` | Compliance teams | Live on-chain event log for every invoice |

---

## Quick Start

### Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Foundry](https://getfoundry.sh) — `curl -L https://foundry.paradigm.xyz | bash`
- [MetaMask](https://metamask.io) browser extension

### 1. Clone & Install

```bash
git clone <repo-url>
cd ADI
yarn install
```

### 2. Start Local Blockchain

```bash
# In a separate terminal
anvil --mnemonic "test test test test test test test test test test test junk" --slots-in-an-epoch 1
```

### 3. Deploy Contracts

```bash
cd packages/foundry
# Deploy in order
forge script script/01_DeployIdentity.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/02_DeployAsset.s.sol     --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/03_DeployVault.s.sol     --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/04_DeployAA.s.sol        --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/05_DeployMerchant.s.sol  --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/06_Configure.s.sol       --rpc-url http://127.0.0.1:8545 --broadcast
```

Copy the deployed contract addresses from the broadcast output.

### 4. Configure Environment

```bash
cd packages/nextjs
cp .env.example .env.local
```

Edit `.env.local` and fill in:
- `NEXT_PUBLIC_USE_LOCAL=true`
- All `NEXT_PUBLIC_*_ADDRESS` values from the deployment output
- `ORACLE_PRIVATE_KEY` — Anvil account #2 private key
- `FAUCET_PRIVATE_KEY` — Anvil account #0 private key
- `IDENTITY_REGISTRY_ADDRESS` — from deployment output
- `ANTHROPIC_API_KEY` — get from [console.anthropic.com](https://console.anthropic.com)

### 5. Run the Frontend

```bash
cd packages/nextjs
yarn dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Demo Walkthrough

### SME Flow (get cash from an invoice)
1. Go to `/sme` and connect wallet (Anvil account #3)
2. Fill in invoice details or upload a PDF — fields auto-fill via Claude AI
3. Click **Request Attestation** — oracle signs the invoice server-side
4. Review the tranche split (80% DDSC advance shown live)
5. Click **Tokenize Invoice** — mints NFT + receives DDSC instantly
6. Invoice appears in dashboard as **Active (Funded)**
7. Click **Simulate Repayment** to simulate the buyer paying back

### Investor Flow (earn yield)
1. Go to `/investor` and connect wallet (Anvil account #4)
2. Click **Mint DDSC** to get test stablecoin
3. Enter an amount and click **Deposit** — wallet receives KYRO vault shares
4. Watch share price rise as SME invoices settle
5. Click **Redeem** to withdraw principal + accrued yield

### Auditor Flow (compliance view)
1. Go to `/auditor`
2. Events load automatically — see every invoice lifecycle event
3. Timeline shows Minted → Settled/Defaulted in chronological order

---

## Demo Mode Simplifications

This is a testnet demo. In production:

| Step | Demo | Production |
|---|---|---|
| KYC | Auto-approves any wallet | Document verification + AML screening |
| Oracle | Signs any well-formed invoice | Queries trade databases + credit scores |
| Vault funding | Mints DDSC if vault is empty | Requires real investor deposits |
| Buyer repayment | SME simulates the transfer | Actual buyer sends DDSC directly |
| Default trigger | Manual button | Oracle confirms invoice is overdue |

---

## Tech Stack

- **Next.js 14** — React SSR framework with API routes
- **Viem** — Type-safe Ethereum interactions
- **Foundry** — Smart contract development, testing, deployment
- **OpenZeppelin** — ERC-4626, ERC-721, access control primitives
- **Anthropic Claude** — Vision API for invoice document parsing
- **ADI Chain** — L1 blockchain (Testnet Chain ID: 99999)

---

## Project Structure

```
ADI/
├── packages/
│   ├── nextjs/          # Frontend (Next.js 14)
│   │   ├── app/         # Pages, API routes, components
│   │   └── lib/         # ABIs, wallet helpers, chain config
│   └── foundry/         # Smart contracts (Solidity)
│       ├── src/         # Contract source
│       ├── script/      # Deploy scripts
│       └── test/        # Foundry tests
├── tasks/todo.md        # Development journal
└── plan.md              # System architecture
```

---

## Hackathon

Built for the **ADI Chain Hackathon** — demonstrating institutional-grade trade finance infrastructure on ADI Chain.

**Standards used:** ERC-4626 · ERC-721 · ERC-3643 · ERC-4337 · ZK Attestation · DDSC
