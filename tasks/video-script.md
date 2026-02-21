# Kyro — Hackathon Demo Video Script

**Target length**: ~3–4 minutes
**Tone**: Confident, clear, institutional — not hype-y
**Structure**: Hook + Problem → Solution (live demo, no slides) → Technical depth → Closing

---

## [HOOK + PROBLEM — 0:00–0:30]

*[Show Kyro landing page, dark/professional UI — stay on it the whole time]*

**Voiceover:**

> "There is a $2 trillion funding gap in global trade finance.
>
> Small and medium-sized businesses ship goods, complete work, and issue invoices — then wait 30, 60, sometimes 90 days to get paid. Most can't access bank credit to bridge that gap. Traditional finance is too slow, too opaque, and too exclusive.
>
> Blockchain hasn't solved this either — because existing protocols lack compliance, institutional-grade architecture, and real UX for businesses that don't know what a wallet is.
>
> So we built Kyro."

---

## [SOLUTION + DEMO — 0:30–2:30]

*[Stay on the live app — no slides. Begin navigating the UI as you speak.]*

**Voiceover:**

> "Kyro is a tokenized trade finance protocol, live on ADI Chain. Let me show you how it works."

### SME Portal

> "I'm an SME. I'll connect my wallet — or, in production, a smart account is created for me automatically.
>
> I upload my invoice here. Watch — the AI extracts the amount and due date from the PDF in seconds.
>
> I request attestation. The oracle signs it. Now I click 'Fund Invoice' — and I receive 800 DDSC instantly. The full transaction is gasless — Kyro's paymaster covered it."

*[Show the invoice appear in the SME dashboard with status ACTIVE]*

### Investor Portal

> "Over on the investor portal — I deposit 1,000 DDSC into the vault. I receive KYRO shares at the current price.
>
> As that invoice settles, interest flows in. My share price rises. I redeem at a higher value."

*[Show vault stats: total assets, share price, deployed capital]*

### Auditor Portal

> "And here's what makes Kyro institutional-grade — a read-only auditor portal. No wallet needed. Every event — invoice minted, funded, settled, or defaulted — is logged immutably on-chain and visible in real time. This is compliance transparency that regulators can actually use."

---

## [TECHNICAL DEPTH — 2:30–3:00]

*[Optional: show simplified architecture diagram or just speak over the landing page]*

**Voiceover:**

> "Under the hood, Kyro is built on four layers.
>
> **Identity and Compliance** — KYC is enforced at the EVM level using ERC-3643. Token transfers are blocked if the recipient isn't verified. This isn't application-layer gating — it's protocol-level compliance.
>
> **Asset Tokenization** — each invoice becomes an ERC-721 NFT. It is split into two ERC-20 tranches: a senior tranche representing 80% of face value, and a junior tranche at 20%. The junior sits with the SME as a first-loss buffer, protecting vault investors from minor defaults.
>
> **Yield Vault** — the ERC-4626 vault holds senior debt at par. When invoices settle, principal plus interest returns to the vault. Share price rises automatically. No manual distribution needed.
>
> **Account Abstraction** — we implemented ERC-4337 with a signature paymaster. SMEs get a counterfactual smart account. They sign UserOperations once, the paymaster covers gas. From the SME's perspective, it just works."

---

## [TRACKS & ALIGNMENT — 3:00–3:25]

*[Hold on Kyro logo or landing page]*

**Voiceover:**

> "Kyro is purpose-built for the ADI Chain hackathon across multiple tracks.
>
> For the **RWA and Tokenisation** track — we tokenize real-world invoices as compliant, transferable financial instruments with institutional-grade access control.
>
> For the **Gas Abstraction** track — we deployed two EntryPoint v0.7-compatible paymasters: a native-token paymaster and an ERC-20 token paymaster using DDSC. Both use a backend-controlled ECDSA sponsor signer — authorization is embedded in paymasterAndData and cryptographically bound to the smart account address, chainId, EntryPoint, and a validity window. No reliance on bundler identity or msg.sender. We ship Foundry deployment scripts, a live sponsor API, and two runnable E2E flows showing a counterfactual account transacting with zero native balance and ERC-20 gas payment. Any team building on ADI can drop this stack in directly.
>
> And for the **Future of Finance** track — Kyro is the bridge between TradFi and DeFi. Real businesses, real invoices, real yield — all on-chain."

---

## [CLOSING — 3:25–3:40]

*[Slow fade to Kyro logo]*

**Voiceover:**

> "Kyro is live on the ADI testnet today. The code is open source, the UI is publicly accessible, and the smart contract architecture is designed for production deployment.
>
> Trade finance is a $10 trillion market. We're starting with invoices. We're not stopping there.
>
> This is Kyro."

---

## Production Notes

- **Keep the demo tight** — pre-stage all wallet states so there's no waiting for transactions
- **Annotate the screen** with small labels: "80% advance in DDSC", "gasless transaction", "oracle attestation" etc.
- **Background music**: minimal, ambient/corporate — nothing distracting
- **Length target**: 3:30–4:00 total
- **Subtitles**: add them — judges may watch muted
