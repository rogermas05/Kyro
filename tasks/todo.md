# ADI Trade Finance — UI Overhaul

## Aesthetic Direction: "ADI Brand Modernist"

Premium institutional finance built on the official ADI brand palette. Deep navy-black backgrounds, the ADI blue (#00355f) as surface color, vibrant orange (#f47820) as the primary accent, Cormorant Garamond serif headings, JetBrains Mono for technical data, and DM Sans for body text. Glassmorphism cards with orange glow on hover.

---

## Color Palette (ADI Brand)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#010f1f` | Page background |
| `--blue-brand` | `#00355f` | Surface/card base |
| `--orange` | `#f47820` | Primary CTA, accents |
| `--white` | `#ffffff` | Primary text |
| `--muted` | `#808080` → `#4e5e6e` | Secondary text |

---

## Routing Changes

| Old | New | Change |
|-----|-----|--------|
| `/` (SME form) | `/` | New landing hero page |
| `/` (SME form) | `/sme` | SME form at new route |
| `/investor` | `/investor` | Redesigned |
| `/merchant` | `/merchant` | Redesigned |
| `/auditor` | `/auditor` | Redesigned |

---

## Todo Items

- [x] 1. Redesign `globals.css` — full design system (CSS variables, Google Fonts, base layout, card/input/button/badge components)
- [x] 2. Redesign `layout.tsx` — fixed glassmorphism nav, updated SME link to /sme
- [x] 3. Create `/` landing page — hero with cinematic heading, 4-portal card grid, 3-step flow, footer CTA
- [x] 4. Create `/sme` page — invoice form with tranche visualization bar (80/20 split)
- [x] 5. Redesign `/investor` page — vault stats grid, deposit/redeem panels
- [x] 6. Redesign `/merchant` page — split-column layout (config left, QR right) + token cost preview chip
- [x] 7. Redesign `/auditor` page — event log table, empty state, event reference legend

---

## Review

### What Changed

**Design System (`globals.css`)**
- Complete rebuild with ADI brand palette: `#010f1f` bg, `#00355f` surfaces, `#f47820` orange accent
- Google Fonts: Cormorant Garamond (headings) + JetBrains Mono (data) + DM Sans (body)
- Geometric grid background with orange radial glow
- Glassmorphism cards with orange border glow on hover
- CSS animation classes: `fade-up`, `fade-up-1` through `fade-up-5`
- Redesigned: nav, buttons, inputs, stats, table, badges, QR wrap, account chip

**Navigation (`layout.tsx`)**
- Fixed glassmorphism nav with backdrop blur
- Brand mark: "ADI Finance" with orange "ADI" accent + "Trade Finance" sub-label
- SME link updated to `/sme`

**Landing Page (`/`)**
- New server component — hero with 5.5rem Cormorant Garamond heading
- 4-portal card grid with SVG icons and numbered background watermarks
- 3-step "Protocol Flow" section
- Tech stack badges (ERC-4626, ERC-721, ERC-3643, ERC-4337, ZK, DDSC)
- Footer CTA with explorer link

**All Portal Pages**
- Shared: page header with eyebrow + serif h1 + subtitle, staggered fade-up animations
- SME: tranche visualization bar showing 80/20 senior/junior split
- Investor: stat grid with monospace orange numbers + unit labels
- Merchant: split-column layout (config left, QR right) + token cost preview chip
- Auditor: event log with empty state illustration, event reference table

**Build result:** `✓ Compiled successfully` — 8 static routes, no type errors.

---

# SME Invoice UX Improvement

## Problem
The SME portal asks users for a raw `0x…` counterparty address and a 65-byte ECDSA ZK proof — impossible for any real user to produce. No oracle signing service existed.

## Solution
- Add a Next.js API route (`/api/attest`) acting as the oracle — hidden from the user entirely
- Rewrite the SME page into a 2-step flow: fill human form → review attested invoice → tokenize

## Todo

- [x] Write plan to tasks/todo.md
- [x] Create `packages/nextjs/app/api/attest/route.ts` — oracle signing endpoint
- [x] Rewrite `packages/nextjs/app/sme/page.tsx` — 2-step UX with file upload
- [x] Add `ORACLE_PRIVATE_KEY` to `.env.example`

## Review

**`/api/attest/route.ts`** (new file)
- POST endpoint acting as the oracle signing service
- Computes `invoiceId = keccak256(wallet + invoiceNumber)` — deterministic, no `Date.now()`
- Signs the message the contract expects: `keccak256(invoiceId || faceValue || dueSecs || docHash)`
- Uses `ORACLE_PRIVATE_KEY` env var (server-side only, never in browser)
- For local anvil: key is Anvil account #2 (address matches `ZK_ORACLE_ADDRESS` in `start-all.sh`)

**`/sme/page.tsx`** (rewritten)
- Fields: Invoice Number, Amount (AED), Due Date, Buyer Name, Buyer Wallet (optional), File Upload
- File hashed in browser via `crypto.subtle.digest('SHA-256')` — document stays private, only hash on-chain
- 3-step progress indicator (Enter Details → Oracle Attests → Tokenize)
- Step 1 → "Request Attestation" → API call → Step 2 review panel
- Review shows attestation badge, invoice summary grid, tranche split (8000 AED senior / 2000 AED junior)
- "← Edit Details" returns to form without losing typed data
- `ORACLE_PRIVATE_KEY` added to `.env.example` with clear local anvil value

**TypeScript:** `tsc --noEmit` passes with zero errors.

---

# Bug Fix: Invoice Tokenize → Auditor Not Showing Events

## Root Cause (2 bugs)

**Bug 1 — Silent tx revert**: `mintInvoice` requires `identityRegistry.isVerified(msg.sender)` but the configure script never KYC-registers any SME wallet (only the vault). So every `mintInvoice` call silently reverts on-chain.

**Bug 2 — UI hides the failure**: `handleMint` calls `waitForTransactionReceipt` but never checks `receipt.status`. A reverted tx still shows "Invoice tokenized!" to the user.

## Plan

- [x] 1. Fix `handleMint` in `sme/page.tsx` — check `receipt.status === 'reverted'` and surface a clear error
- [x] 2. Create `/api/register-sme/route.ts` — uses deployer key (COMPLIANCE_AGENT_ROLE) to call `registerIdentity` + `setKycStatus` on the IdentityRegistry for any wallet address
- [x] 3. Call `/api/register-sme` inside `handleAttest` (before the oracle attest step) so the wallet is guaranteed to be KYC-registered before minting
- [x] 4. Add `IDENTITY_REGISTRY_ADDRESS` to `.env.local` and `.env.example`

## Review

**`sme/page.tsx`**
- `handleMint` now stores the receipt and checks `receipt.status === 'reverted'`, showing a real error instead of fake success
- `handleAttest` now calls `/api/register-sme` first (silently), then proceeds to oracle attestation

**`/api/register-sme/route.ts`** (new)
- Uses `FAUCET_PRIVATE_KEY` (Anvil deployer = `COMPLIANCE_AGENT_ROLE` on IdentityRegistry)
- Reads `isVerified(wallet)` first — if already verified, returns early (idempotent)
- Otherwise calls `registerIdentity(wallet, 784)` then `setKycStatus(wallet, true)`

**`.env.local`** — added `IDENTITY_REGISTRY_ADDRESS=0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` (from deployment broadcast)

**`.env.example`** — added `IDENTITY_REGISTRY_ADDRESS=0x...` with documentation comment

---

# Fix: Complete Invoice Lifecycle (Fund → Settle/Default)

## Problem

The invoice lifecycle is broken after minting:
1. **Missing env vars**: `NEXT_PUBLIC_JUNIOR_TOKEN_ADDRESS` and `NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS` are used in `sme/page.tsx` but not set, so J-DEBT balance and KYC badge never appear.
2. **No way to fund invoices**: After an SME mints an invoice (PENDING), someone with `OPERATOR_ROLE` must call `vault.purchaseSeniorTranche(invoiceId)` to send DDSC to the SME and move the invoice to ACTIVE. No UI or API exists for this.
3. **No way to settle/default**: The `settleInvoice` and `defaultInvoice` functions on the orchestrator require `SETTLEMENT_ROLE` (the deployer). No UI or API exists to trigger these, so the lifecycle never completes.
4. **Investor can't manage the vault**: The investor page has no view of pending/active invoices, no way to fund them, and no way to simulate buyer repayment or default.
5. **Investor deposit may fail**: The vault's `deposit()` requires KYC, but the investor page doesn't auto-register the wallet before depositing.

## Plan

- [x] 1. Fix `.env.local` — add `NEXT_PUBLIC_JUNIOR_TOKEN_ADDRESS` and `NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS`
- [x] 2. Create `/api/fund-tranche/route.ts` — operator calls `vault.purchaseSeniorTranche(invoiceId)` (sends DDSC to SME, transfers S-DEBT to vault, invoice → ACTIVE)
- [x] 3. Create `/api/settle-invoice/route.ts` — mints faceValue DDSC to orchestrator then calls `orchestrator.settleInvoice(invoiceId)` (simulates buyer repayment, vault earns yield)
- [x] 4. Create `/api/default-invoice/route.ts` — calls `orchestrator.defaultInvoice(invoiceId)` with 0 recovery (simulates non-payment, J-DEBT wiped)
- [x] 5. Update `investor/page.tsx` — add "Invoice Management" panel: lists all on-chain invoices (PENDING/ACTIVE), with Fund / Simulate Repayment / Simulate Default buttons; also auto-KYC investor wallet before deposit

## Review

**`.env.local`** — added `NEXT_PUBLIC_JUNIOR_TOKEN_ADDRESS` and `NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS` (fixes J-DEBT balance and KYC badge on SME page)

**`/api/fund-tranche/route.ts`** (new) — reads invoice seniorAmount, auto-mints DDSC to vault if short (local demo only), calls `vault.purchaseSeniorTranche` → DDSC goes to SME, invoice moves PENDING → ACTIVE

**`/api/settle-invoice/route.ts`** (new) — mints full face value (senior+junior) DDSC to orchestrator (simulates buyer repayment), calls `orchestrator.settleInvoice` → S-DEBT+J-DEBT burned, DDSC forwarded to vault, share price rises

**`/api/default-invoice/route.ts`** (new) — calls `orchestrator.defaultInvoice` with 0 recovery → J-DEBT wiped from SME, S-DEBT burned from vault with 0 DDSC return

**`investor/page.tsx`** — deposit now auto-KYCs wallet first; new "Invoice Management" panel shows all on-chain invoices grouped by state (PENDING → Fund button, ACTIVE → Simulate Repayment + Default buttons, Closed → history). Reads `InvoiceMinted/Settled/Defaulted` events + on-chain state for each invoice.

**TypeScript:** `tsc --noEmit` passes with zero errors.

---

# UX Clarity Pass: Investor & SME Pages

## Problem

Both pages have too much explanatory text that buries the actual user flows. Walls of body copy make it unclear what the user should *do* at each step.

## Diagnosis

**Investor page:**
- Subtitle under "Kyro Vault" is 3 sentences — too long
- "How Yield Works" card has 4 long text blocks + a "Fixed Financing Rate" callout — pure noise for a demo
- Deposit card has a paragraph before the input field
- Redeem card has a long multi-clause explanation sentence

**SME page:**
- Subtitle is 2 sentences
- "How It Works" step 3 is a 2-sentence wall describing exact token mechanics
- "How It Works" step 4 is a 2-sentence wall about repayment
- Done screen "What happens next" has 4 long list items with extensive detail
- Review screen "Financing economics" callout repeats numbers already shown in the tranche split grid

## Plan

- [x] 1. **investor/page.tsx**: Remove "How Yield Works" card entirely; shorten subtitle to 1 line; trim deposit card description; trim redeem card description
- [x] 2. **sme/page.tsx**: Shorten subtitle to 1 line; trim "How It Works" step 3 and step 4 text to 1 line each; replace done screen "What happens next" list with 3 short bullets; remove "Financing economics" verbose callout from review screen

## Review

**`investor/page.tsx`**
- Subtitle: 3 sentences → 1 ("Deposit DDSC, earn yield as SME invoices settle.")
- Removed entire "How Yield Works" card (~55 lines of explanatory text)
- Removed paragraph before deposit input
- Redeem description simplified to a single line with inline yield badge

**`sme/page.tsx`**
- Subtitle: 2 sentences → 1
- "How It Works" step 3: massive tranche-mechanics paragraph → 1 line
- "How It Works" step 4: 2-sentence repayment wall → 1 line
- Done screen "What happens next": 4 long paragraphs → 3 short numbered bullets
- Review screen: removed "Financing economics" callout (numbers already visible in the tranche split grid above it)
