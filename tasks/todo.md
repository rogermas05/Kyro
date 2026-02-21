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
- [x] 6. Redesign `/merchant` page — split config + QR layout, token preview
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
