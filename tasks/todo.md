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

---

# Fix: Vault/Yield Info Without Wallet

## Problem

The "Vault Performance" section only shows after a wallet is connected, because `loadStats(acct)` requires a wallet address. Public vault data (`totalAssets`, `vaultCash`, `sharePrice`) doesn't need a wallet.

## Plan

- [x] 1. In `investor/page.tsx`: make `loadStats` accept an optional account. When no account, fetch only the 3 public fields and set wallet-specific fields (`myShares`, `myDDSC`, `ddscBalance`) to `0n`.
- [x] 2. Add a `useEffect` on mount (no dependencies) that calls `loadStats()` with no account — loads public vault stats immediately.
- [x] 3. Update the Refresh button to call `loadStats(account ?? undefined)` so it works with or without a wallet.

## Review

**`investor/page.tsx`**
- `loadStats` now accepts `acct?: 0x${string}`. Always fetches `totalAssets`, `vaultCash`, `sharePrice` (public). Only fetches `myShares`, `myDDSC`, `ddscBalance` when `acct` is provided.
- Added a mount-time `useEffect` (empty deps) that calls `loadStats()` — Vault Performance card now appears immediately on page load.
- Refresh button changed from `account && loadStats(account)` to `loadStats(account ?? undefined)` — works with or without a wallet.

---

# Flow Critical Analysis & UX Clarity

## Critical Analysis of Current Flow

### What the flow actually does (vs what it implies)

**Step 1 – KYC Registration (`/api/register-sme`)**
- Any wallet that calls this endpoint is auto-approved with no identity check
- Country hardcoded to 784 (UAE)
- In production: would require identity documents, business registration, AML screening
- Currently: zero verification — purely for local demo gating

**Step 2 – Oracle Attestation (`/api/attest`)**
- The oracle signs ANY well-formed request without checking:
  - Whether the invoice actually exists
  - Whether the buyer is real or creditworthy
  - Whether the SME and buyer have a genuine trade relationship
  - Whether the amount is accurate
  - Whether the document is a real invoice (only a hash is stored, content never checked)
- The code itself notes: "For demo/testnet it signs any well-formed request"
- In production: oracle would query trade databases, check credit scores, verify legal documents

**Step 3 – Minting**
- After mint, `/api/fund-tranche` is called automatically
- If the vault has no DDSC, it **mints DDSC from thin air** to fund the invoice
- This bypasses any real investor liquidity requirement — pure demo shortcut

**Step 4 – Settlement (most confusing step)**
- "Confirm Buyer Repaid" button requires the **SME to transfer their own DDSC** to the orchestrator
- The SME is literally simulating buyer payment from their own wallet
- In production: the buyer would transfer directly; the oracle would confirm payment off-chain
- The current UI label completely hides this mechanic

**Step 5 – Default**
- Any caller can trigger default via `/api/default-invoice`
- No timelock, no overdue check, no oracle verification of non-payment

### Summary: What's real vs demo
| Step | Demo | Production |
|---|---|---|
| KYC | Auto-approve any wallet | Document verification + AML |
| Oracle attestation | Signs anything | Credit check + trade DB lookup |
| Vault funding | Mints DDSC if needed | Requires real investor deposits |
| Buyer repayment | SME transfers own DDSC | Buyer transfers directly |
| Default | Anyone triggers it | Oracle confirms overdue |

## Plan

- [ ] 1. Add a "Demo Mode" callout card on the SME page explaining these simplifications clearly
- [ ] 2. Update "How It Works" step 2 to accurately describe oracle role (demo vs production)
- [ ] 3. Rename "Confirm Buyer Repaid" → "Simulate Buyer Repayment" and add a sub-label explaining it
- [ ] 4. In the ACTIVE invoice controls, add a one-line note that the SME is simulating the buyer transferring DDSC
- [ ] 5. Update landing page Step 1 "Originate" to be more honest about what oracle verification covers

## Todo

- [x] 1. `sme/page.tsx` — Add demo disclaimer callout card below wallet bar
- [x] 2. `sme/page.tsx` — Update "How It Works" step 2 oracle description
- [x] 3. `sme/page.tsx` — Rename "Confirm Buyer Repaid" button + add sub-note for active invoice controls
- [x] 4. `page.tsx` (landing) — Update Step 1 "Originate" description to be accurate about oracle attestation

## Review

**`sme/page.tsx`**
- Added an orange "⚑ Demo / Testnet Mode" callout card visible to all users, explaining that KYC, oracle attestation, and buyer repayment are simplified for the demo
- Updated "How It Works" step 2: now says the oracle signs any valid request in demo, but in production would check trade databases and buyer creditworthiness
- "Confirm Buyer Repaid" button renamed to "Simulate Repayment" — sub-note now explains the SME is transferring their own DDSC to simulate the buyer, not confirming a real payment
- "Mark as Defaulted" button label unchanged (already clearly a simulation trigger)

**`page.tsx` (landing)**
- Step 1 "Originate" description updated: now mentions the oracle checks buyer creditworthiness and trade records in production, and clarifies that only a document hash goes on-chain

---

# Feature: Automatic Invoice Parsing

## Goal

When an SME uploads an invoice document (PDF or image), automatically parse it and pre-fill the form fields (invoice number, amount, due date, buyer name) using Claude's vision API.

## Plan

- [x] 1. Install `@anthropic-ai/sdk` in `packages/nextjs`
- [x] 2. Add `ANTHROPIC_API_KEY=` to `.env.example`
- [x] 3. Create `/api/parse-invoice/route.ts` — accepts file via `FormData`, calls Claude with image/PDF content, returns structured JSON `{ invoiceNumber, amount, dueDate, buyerName }`
- [x] 4. Update `sme/page.tsx` — on file upload, call the parse API, show "Parsing…" state in the drop zone, auto-fill extracted fields

## Review

**`@anthropic-ai/sdk`** — installed as a dependency in `packages/nextjs`

**`.env.example`** — added `ANTHROPIC_API_KEY=sk-ant-...` with a comment pointing to console.anthropic.com

**`/api/parse-invoice/route.ts`** (new) — accepts a `multipart/form-data` POST with a `file` field; for images calls `client.messages.create` with a base64 `image` block; for PDFs uses `client.beta.messages.create` with a `document` block + `pdfs-2024-09-25` beta; prompts Claude haiku to return JSON `{ invoiceNumber, amount, dueDate, buyerName }`; strips any markdown fences before parsing

**`sme/page.tsx`** — added `parsing` boolean state; replaced `setFile` inline handler with `handleFileChange` which posts the file to `/api/parse-invoice` and fills `invoiceNumber`, `faceValue`, `dueDate`, `buyerName` from the response; drop zone now shows "⟳ Parsing invoice…" while waiting; hint text updated to "PDF or image · fields auto-filled · hash anchored on-chain"; all changes gracefully no-op on error

## Notes

- For images (PNG, JPEG, WebP, GIF): send as `image` content block with base64
- For PDFs: send as `document` content block (Anthropic PDF support)
- Fields auto-filled only; user can still edit them freely
- If parsing fails, silently skip — form works exactly as before

---

# UI Dopamine Pass — Make It More Exciting

## Goal

Core functionality is complete. The UI needs to feel more alive — financial dashboards should hit dopamine receptors with glowing numbers, satisfying micro-animations, and a celebratory success moment. All changes are CSS-first and minimal.

## Diagnosis

| Area | Current | Problem |
|---|---|---|
| Stat values | Static orange monospace | Flat — no visual weight or energy |
| Primary button | Solid orange, simple hover | Forgettable — no excitement |
| Success screen | Plain ✓ emoji | Biggest UX moment feels anticlimactic |
| Active invoice | Text badge only | No sense of "live" or urgency |
| Background | Fixed grid | Completely static — no depth |
| Cards | Border color on hover | Low contrast hover — feels cheap |
| Share price (investor) | Flat number | Most important metric has no glow |

## Plan

### 1. `globals.css` — Core animation additions (most bang for buck)
- `@keyframes shimmer-sweep` — light sweeps across `.btn-primary` on loop
- `@keyframes pulse-ring` — expanding ring animation class for success states
- `@keyframes active-pulse` — green glow pulse for live/active indicators
- `@keyframes float` — slow vertical float for decorative background elements
- `.stat-value` — add `text-shadow` orange glow on hover
- `.card` — stronger hover: `translateY(-3px)` + stronger `box-shadow`
- `.stat` — hover lift with orange glow
- `.stat-value` — subtle scale on hover

### 2. `sme/page.tsx` — Success screen celebration
- Replace plain "✓" emoji with a large animated ring + glow
- Add a CSS radial burst (concentric expanding rings) behind the checkmark
- Green pulsing dot next to "ACTIVE" invoice state badges

### 3. `investor/page.tsx` — Share price hero + live feel
- Add orange text-shadow glow to share price number when `yieldPositive`
- Add a subtle pulsing indicator dot next to "Share Price" label
- Glow class on the yield badge background

### 4. `page.tsx` (homepage) — Hero depth
- Add a single floating animated gradient orb div behind the hero heading
- Animate the "On-Chain." italic text with a subtle shimmer/glow

## Todo

- [x] 1. `globals.css` — Button shimmer sweep animation + stronger card/stat hover effects
- [x] 2. `globals.css` — Add `pulse-ring`, `active-pulse`, `float` keyframes and utility classes
- [x] 3. `sme/page.tsx` — Replace ✓ emoji with animated ring celebration in done step; add pulse dot to ACTIVE badge
- [x] 4. `investor/page.tsx` — Add glow to share price + yield badge when positive
- [x] 5. `page.tsx` — Add floating orb behind hero heading

## Review

**`globals.css`**
- `.btn-primary` — shimmer sweep (`shimmer-sweep` keyframe): a light band slides across the button every 2.8s
- `.card:hover` — now lifts `translateY(-2px)` with a stronger orange box-shadow; feels tactile
- `.stat:hover` — lifts `translateY(-2px)` + orange glow; `.stat-value` gets `text-shadow` glow on hover
- New keyframes: `shimmer-sweep`, `pulse-ring`, `active-pulse`, `float`, `glow-pulse`
- New utility classes: `.live-dot` (pulsing green dot), `.glow-pulse` (breathing orange text glow), `.float` (gentle vertical float)

**`sme/page.tsx`**
- "Invoice Tokenized!" success screen: replaced plain ✓ emoji with a 72px container showing 3 staggered expanding rings (`pulse-ring`) around a glowing green core circle
- ACTIVE invoice badge: shows a small blue pulsing dot (`active-pulse`) before the "Active (Funded)" text label

**`investor/page.tsx`**
- Share price hero: when `yieldPositive`, the entire panel gets a green border + subtle glow; share price number gets `glow-pulse` breathing animation + green text-shadow; a `.live-dot` appears next to the "Share Price" label; yield badge gets a box-shadow glow

**`page.tsx`**
- Hero section: two absolutely-positioned gradient orbs float behind the heading (`float` animation, 7s and 9s loops with offset delay); "On-Chain." italic gets `.glow-pulse` for a breathing orange glow; all hero content has `zIndex: 1` to stay above the orbs

---

# Architecture & Layout Redesign — First Principles

## Diagnosis

**All pages suffer from the same root problem: single-column vertical card stacks that bury the most important information and actions below secondary content.**

| Problem | Pages | Impact |
|---|---|---|
| No active page indicator in nav | All | Disorienting — user doesn't know where they are |
| Invoice dashboard buried BELOW the form | SME | Active invoices are the most important thing when they exist |
| No live DDSC preview while filling form | SME | User fills out form blind — doesn't see the outcome |
| Vault stats come BEFORE your position | Investor | Wrong priority — users care about their money, not vault totals |
| Deposit / Redeem / Mint DDSC all same card style | Investor | No hierarchy — user doesn't know what to do first |
| Wallet bar + disclaimer + tranche bar = 3 preamble blocks | SME | Too much noise before core action |
| Desktop space wasted — 880px single column | Both portals | Two-column layout would make pages scannable instead of scrolly |
| Step indicator is tiny dots | SME | Progress state is hard to read at a glance |

## Redesign Plan

### 1. Nav active state (`layout.tsx` + new `NavLinks.tsx`)
Create a client component using `usePathname()` so nav links highlight the current page. Nav currently has zero active state on subpages.

### 2. SME page — restructure information priority
**New order:**
1. Compact wallet + disclaimer in ONE unified bar (not two separate blocks)
2. **If connected + has invoices: Invoice dashboard comes FIRST** — hero card above the form
3. Form wizard with TWO-COLUMN layout:
   - Left (55%): Upload zone + form fields
   - Right (45%): **Live "You'll receive" preview panel** — shows `~X,XXX DDSC immediately` in large type, updating as faceValue changes; replaces the separate tranche bar
4. Remove standalone tranche bar (absorbed into live preview)
5. Remove "How It Works" card from flow (it's redundant with the landing page)

### 3. Investor page — lead with position, not vault
**New order:**
1. Wallet connection
2. **Your Position hero** (big numbers: your DDSC, your shares, your yield) — empty state CTA to deposit if no shares
3. Below the fold: two-column — Vault Performance (left) | Deposit & Redeem (right)
4. Mint DDSC moves to a small secondary area, visually de-emphasized

### 4. Homepage portal cards — increase visual weight
- Make the two main portals (SME, Investor) visually featured vs. the secondary ones (Merchant, Auditor)
- Portal cards get taller minimum height and bolder hover states

### 5. globals.css — two-column layout utility
- `.two-col` class: `display: grid; grid-template-columns: 55fr 45fr; gap: 1.5rem; align-items: start`
- `.two-col-equal`: `1fr 1fr` split
- Responsive: collapse to single column below 720px

## Todo

- [x] 1. Create `NavLinks.tsx` client component with active state; update `layout.tsx` to use it
- [x] 2. `sme/page.tsx` — Combine wallet bar + disclaimer into one compact banner
- [x] 3. `sme/page.tsx` — Move invoice dashboard above the form when invoices exist
- [x] 4. `sme/page.tsx` — Two-column form layout with live "You'll receive" preview replacing tranche bar
- [x] 5. `investor/page.tsx` — Promote "Your Position" to top hero; two-column for vault stats + actions
- [x] 6. `page.tsx` — Feature SME and Investor portal cards over secondary portals
- [x] 7. `globals.css` — Add `.two-col` and `.two-col-equal` layout utilities + responsive collapse

## Review

**`NavLinks.tsx`** (new file)
- Client component using `usePathname()` to highlight the active nav link with `.nav-active` class

**`layout.tsx`**
- Replaced static nav links with `<NavLinks />` component; added `WalletProvider` + `WalletButton` to nav

**`globals.css`**
- `.page` max-width widened to 980px; `.page-wide` added at 1080px
- `.two-col` (55fr/45fr split) and `.two-col-equal` (1fr/1fr) grid utilities added; collapse to single column below 720px
- `.btn-primary` shimmer sweep animation, stronger `.card:hover` lift, `.stat:hover` glow, `.stat-value` text-shadow on hover
- New keyframes: `shimmer-sweep`, `pulse-ring`, `active-pulse`, `float`, `glow-pulse`
- Utility classes: `.live-dot`, `.glow-pulse`, `.float`

**`investor/page.tsx`**
- New page order: compact wallet bar → Your Position hero card (big total DDSC value + 3 stat tiles) → two-col layout (Vault card with SVG donut chart left | Deposit / Redeem / Mint actions right)
- SVG donut chart shows deployed (blue) vs idle (orange) capital with animated `stroke-dasharray` transition
- Share price row shows green glow + `.live-dot` + `glow-pulse` animation when yield is positive
- Redeem card appears conditionally only when user has shares; Mint DDSC de-emphasized (no card border)

**`sme/page.tsx`**
- Wallet bar + testnet disclaimer merged into one unified bar (top row: address/balances/buttons; bottom strip: testnet notice)
- My Invoices dashboard moved ABOVE the form so active invoices are visible first
- Form step wrapped in `.two-col` — left: form card; right: sticky "Funding Preview" panel showing 80% DDSC advance live as user types face value
- Success screen: animated triple-ring celebration replacing plain ✓ emoji; ACTIVE badge gets pulsing blue dot
- Removed: standalone tranche bar, "How It Works" card from the flow

**`page.tsx`**
- Hero: two floating gradient orbs (`float` animation); "On-Chain." italic gets `.glow-pulse` breathing effect
- Portal cards: SME and Investor cards visually featured with gradient background + orange left accent strip; secondary portals at 0.75 opacity

---

# Feature: Move Wallet Connection to Header

## Plan

- [x] 1. Create `app/context/WalletContext.tsx` — React context with `account`, `setAccount`, auto-reconnect on mount (local key restore + browser `eth_accounts`)
- [x] 2. Create `app/components/WalletButton.tsx` — header button: shows "Connect Wallet" or truncated address with Switch option; handles local Anvil account picker
- [x] 3. Update `layout.tsx` — wrap body with `WalletProvider`; add `WalletButton` to the nav
- [x] 4. Update `investor/page.tsx` — use `useWallet()` for account; remove local wallet handlers + auto-reconnect effect + wallet bar JSX
- [x] 5. Update `sme/page.tsx` — use `useWallet()` for account; remove local wallet handlers + auto-reconnect effect + wallet bar JSX (keep KYC/balance display strip)

## Review

**`app/context/WalletContext.tsx`** (new) — `WalletProvider` stores `account` in React state; auto-reconnects on mount via `wallet_active_key` localStorage (local mode) or `eth_accounts` (browser mode). `useWallet()` hook exposes account to any page.

**`app/components/WalletButton.tsx`** (new) — placed in the nav; shows "Connect Wallet" / Anvil account picker (local mode) or truncated `0x…` address + Switch + Disconnect (browser mode). Persists local key to `wallet_active_key` in localStorage.

**`layout.tsx`** — wrapped body in `<WalletProvider>`; added `<WalletButton />` as last item in nav.

**`investor/page.tsx`** — replaced `useState` account + three wallet handlers + auto-reconnect effect with `useWallet()`; removed the entire wallet bar JSX block.

**`sme/page.tsx`** — same; replaced wallet state + four handlers + auto-reconnect effect with `useWallet()`; replaced the full wallet bar with a compact "account info strip" (KYC badge + balances + refresh) that only renders when connected. Added `useEffect([account])` to reset form state on disconnect.

**TypeScript:** `tsc --noEmit` — zero errors.

---

# Landing Page Copy Improvement

## Goal

Make copy on `page.tsx` clearly explain what Kyro does while feeling exciting and enticing. Current copy leads with jargon ("institutional-grade RWA credit engine", "senior tranche", internal event names) before explaining value in plain English.

## Planned Changes

| Location | Current | Proposed |
|---|---|---|
| Hero line 2 | `On-Chain.` (orange) | `Reimagined.` (orange) |
| Hero line 3 | `Liquid. Compliant.` (muted) | `Instant cash. Real yield.` (muted) |
| Hero paragraph | "Kyro is an institutional-grade RWA credit engine…" | "SMEs upload invoices and receive DDSC stablecoin immediately — no 30-day wait, no banks. Investors earn real yield as those invoices are repaid. Transparent and verifiable on ADI Chain." |
| Portal section subhead | "Each actor in the trade finance lifecycle has a dedicated portal." | "From invoice upload to yield withdrawal — every role has a dedicated portal." |
| SME card title | "Tokenize Trade Invoices" | "Get Cash From Your Invoices" |
| SME card desc | "oracle-attested … RWA tokens … senior tranche" | Plain English: upload invoice, get DDSC instantly, no banks |
| Investor card title | "Earn Yield on DDSC" | "Earn Real-World Yield" |
| Investor card desc | "ERC-4626 Trade Finance Vault … senior tranche priority" | Plain English: deposit DDSC, earn yield from real buyer repayments |
| Auditor card desc | Lists `InvoiceMinted`, `InvoiceSettled`, `InvoiceDefaulted` | "A live, immutable log of every invoice — from creation to settlement." |
| Step 2 desc | "InvoiceOrchestrator mints NFT. 80% senior tranche enters the vault…" | Plain English: invoice becomes NFT, 80% to vault, DDSC to wallet instantly |
| Footer headline | "Ready to explore the protocol?" | "Stop waiting to get paid." |
| Footer sub-copy | "Kyro runs on ADI Testnet (Chain ID 99999). Connect MetaMask to interact." | "Kyro turns outstanding invoices into instant liquidity — live on ADI Testnet. Connect MetaMask and try it yourself." |

## Todo

- [x] 1. `page.tsx` — Rewrite hero headline lines 2 & 3
- [x] 2. `page.tsx` — Rewrite hero sub-paragraph
- [x] 3. `page.tsx` — Update portal section subhead + all three portal card copy
- [x] 4. `page.tsx` — Rewrite step 2 description
- [x] 5. `page.tsx` — Rewrite footer CTA headline and sub-copy

## Review

**`page.tsx`** — text-only changes, no structural edits:
- Hero line 2: `On-Chain.` → `Reimagined.` (keeps orange glow)
- Hero line 3: `Liquid. Compliant.` → `Instant cash. Real yield.`
- Hero paragraph: replaced jargon ("RWA credit engine", "ERC-4626 vault-backed", "Account Abstraction") with plain English value prop — SMEs get cash now, investors earn real yield, all on-chain
- Portal section subhead: more descriptive — covers all roles in one clear sentence
- SME card: title "Tokenize Trade Invoices" → "Get Cash From Your Invoices"; desc drops "oracle-attested", "RWA tokens", "senior tranche"
- Investor card: title "Earn Yield on DDSC" → "Earn Real-World Yield"; desc drops "ERC-4626", "senior tranche priority"
- Auditor card: desc drops internal event names (`InvoiceMinted` etc.), replaced with plain description
- Step 2: removed "InvoiceOrchestrator mints NFT" — replaced with plain English flow
- Footer headline: "Ready to explore the protocol?" → "Stop waiting to get paid."
- Footer sub-copy: more action-oriented, less dry technical detail

---

# Hackathon Polish: 6 Missing Features

## Goal
Implement the 6 features identified in the hackathon gap analysis, in order of priority.

## Todo

- [x] 1. Write root `README.md` — project description, architecture, tech stack, quick start, demo guide
- [x] 2. Auditor auto-fetch on mount — add `useEffect` to call `fetchEvents()` on load instead of requiring button click
- [x] 3. Live stats strip on landing page — client component fetching total invoices, DDSC disbursed, vault TVL, current yield from contracts
- [x] 4. Due date countdown on active SME invoices — show "Due in X days" next to ACTIVE invoice cards (already has `daysLeft` helper)
- [x] 5. Auditor timeline view — replace flat event table with vertical timeline showing invoice lifecycle
- [x] 6. Yield history sparkline on investor page — mini SVG chart of share price across the last N InvoiceSettled events

## Review

**`README.md`** (new root file)
- Full hackathon README: project description, architecture diagram, contract overview table, portal overview, quick start (Anvil + Foundry deploy steps), demo walkthrough for all 3 roles, demo simplifications table, tech stack, project structure

**`auditor/page.tsx`**
- Added `useEffect(() => { fetchEvents() }, [])` — events load on mount, no button required
- Replaced the flat `<table>` with a vertical timeline: left-aligned color-coded dot + connecting vertical line + card per event, with icon (◆/✓/✕) and dotColor per event type
- Added a loading state message while scanning; removed the pre-fetch empty state (no longer needed since we auto-fetch)

**`components/ProtocolStats.tsx`** (new file)
- Client component: on mount fetches `InvoiceMinted` events + `totalAssets()` + `convertToAssets(1e18)` from contracts
- Computes: total invoices funded, DDSC disbursed (sum of seniorAmount), vault TVL, current yield %
- Renders a stat strip with 4 monospace figures (orange/green); hidden if contracts not deployed

**`page.tsx`** (landing)
- Imported `ProtocolStats` and placed it between the hero section and the divider before portal cards
- Strip appears seamlessly below hero; invisible if contracts not configured

**`sme/page.tsx`**
- Added a prominent due-date countdown pill inside the ACTIVE invoice action section
- Pill changes color: gray (>7d), orange (≤7d), red (overdue) with `⏱ Due in Xd` / `⚠ Xd overdue` text
- Appears above the Demo note and action buttons; only rendered when `days !== null`

**`investor/page.tsx`**
- Added `Sparkline` component: pure SVG `<polyline>` rendering N data points; shows end dot; green when yield positive
- Added `sparkPoints` state: computed in `loadStats` by fetching `InvoiceSettled` events and linearly interpolating share price from 1.0 → current across N settlements
- Added `ORCHESTRATOR` constant and `ORCHESTRATOR_ABI` import
- Sparkline renders beside the yield badge in the share price panel when ≥2 points available

**TypeScript:** `tsc --noEmit` — zero errors.
