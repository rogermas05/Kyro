const PORTALS = [
  {
    num: '01',
    label: 'SME Portal',
    title: 'Tokenize Trade Invoices',
    desc: 'Upload oracle-attested invoices and convert them into on-chain RWA tokens. Receive instant DDSC liquidity against your senior tranche.',
    href: '/sme',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="6" y="4" width="20" height="24" rx="3" stroke="#f47820" strokeWidth="1.5" fill="none"/>
        <line x1="10" y1="10" x2="22" y2="10" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="10" y1="14" x2="22" y2="14" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
        <line x1="10" y1="18" x2="17" y2="18" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
      </svg>
    ),
  },
  {
    num: '02',
    label: 'Investor Portal',
    title: 'Earn Yield on DDSC',
    desc: 'Deposit DDSC into the ERC-4626 Trade Finance Vault. Earn real yield as SME invoices are settled — principal protected by senior tranche priority.',
    href: '/investor',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <polyline points="4,24 10,16 16,20 22,10 28,6" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <polyline points="22,6 28,6 28,12" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
  },
  {
    num: '03',
    label: 'Merchant Portal',
    title: 'Accept Any Token',
    desc: 'Configure KyroPay for your storefront. Customers pay in mADI or DDSC — the on-chain swap router delivers your preferred token automatically.',
    href: '/merchant',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="10" width="24" height="16" rx="3" stroke="#f47820" strokeWidth="1.5" fill="none"/>
        <path d="M4 16h24" stroke="#f47820" strokeWidth="1.5" opacity="0.5"/>
        <rect x="8" y="20" width="6" height="2" rx="1" fill="#f47820" opacity="0.5"/>
        <path d="M10 10V7a6 6 0 0 1 12 0v3" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </svg>
    ),
  },
  {
    num: '04',
    label: 'Auditor Portal',
    title: 'Track Compliance On-Chain',
    desc: 'Real-time event log for every invoice lifecycle event. InvoiceMinted, InvoiceSettled, InvoiceDefaulted — all verifiable on ADI Chain.',
    href: '/auditor',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <path d="M16 4L6 8v10c0 5.5 4.5 9.5 10 10 5.5-.5 10-4.5 10-10V8L16 4z" stroke="#f47820" strokeWidth="1.5" fill="none"/>
        <polyline points="11,16 14,19 21,12" stroke="#f47820" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
]

const STEPS = [
  {
    n: '1',
    title: 'Originate',
    desc: 'SME submits invoice details. Off-chain oracle signs a ZK attestation of invoice validity — no sensitive data on-chain.',
  },
  {
    n: '2',
    title: 'Tokenize & Fund',
    desc: 'InvoiceOrchestrator mints NFT. 80% senior tranche enters the vault; SME receives DDSC immediately against that collateral.',
  },
  {
    n: '3',
    title: 'Settle & Yield',
    desc: 'When the buyer repays, the vault settles automatically. Share price rises — investors redeem shares for principal plus accrued yield.',
  },
]

export default function HomePage() {
  return (
    <div style={{ paddingTop: 'var(--nav-h)' }}>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section style={{
        minHeight: 'calc(100vh - var(--nav-h))',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        maxWidth: 1080,
        margin: '0 auto',
        padding: '5rem 2rem 4rem',
      }}>
        <div className="eyebrow fade-up" style={{ marginBottom: '1.75rem' }}>
          Real-World Assets · ADI Chain · kyro.cash
        </div>

        <h1 className="fade-up-1" style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 'clamp(3rem, 7vw, 5.5rem)',
          fontWeight: 600,
          lineHeight: 1.05,
          maxWidth: 720,
          marginBottom: '1.75rem',
          letterSpacing: '-0.02em',
        }}>
          Invoice Finance,<br />
          <em style={{ color: 'var(--orange)', fontStyle: 'italic' }}>On-Chain.</em><br />
          <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>Liquid. Compliant.</span>
        </h1>

        <p className="fade-up-2" style={{
          color: 'var(--text-2)',
          fontSize: '1.05rem',
          lineHeight: 1.8,
          maxWidth: 520,
          marginBottom: '2.75rem',
        }}>
          Kyro is an institutional-grade RWA credit engine on ADI Chain. Tokenize trade
          invoices into compliant, liquid instruments — ZK-verified, ERC-4626 vault-backed,
          with Account Abstraction for seamless UX.
        </p>

        <div className="fade-up-3" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '3.5rem' }}>
          <a href="/investor" className="btn btn-primary" style={{ width: 'auto', margin: 0 }}>
            Investor Portal
          </a>
          <a href="/sme" className="btn btn-secondary" style={{ margin: 0 }}>
            SME Onboarding
          </a>
        </div>

        {/* Tech stack badges */}
        <div className="fade-up-4" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {['ERC-4626', 'ERC-721', 'ERC-3643', 'ERC-4337', 'ZK Attestation', 'DDSC'].map(tag => (
            <span key={tag} style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.66rem',
              color: 'var(--muted)',
              border: '1px solid rgba(0,53,95,0.6)',
              borderRadius: 99,
              padding: '0.3rem 0.8rem',
              background: 'rgba(0,53,95,0.2)',
              letterSpacing: '0.04em',
            }}>{tag}</span>
          ))}
        </div>
      </section>

      <div className="divider" />

      {/* ── Portal Cards ────────────────────────────────────────── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '6rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <div className="eyebrow">Platform Portals</div>
          <h2 style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 'clamp(1.8rem, 4vw, 2.6rem)',
            fontWeight: 600,
            marginTop: '0.5rem',
          }}>
            Four roles. One protocol.
          </h2>
          <p style={{ color: 'var(--text-2)', marginTop: '0.75rem', fontSize: '0.95rem' }}>
            Each actor in the trade finance lifecycle has a dedicated portal.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '1.25rem',
        }}>
          {PORTALS.map((p) => (
            <a
              key={p.href}
              href={p.href}
              style={{ textDecoration: 'none', display: 'block' }}
            >
              <div className="card" style={{ height: '100%', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
                {/* Background number */}
                <div style={{
                  position: 'absolute', top: '1rem', right: '1.25rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '3rem', fontWeight: 500,
                  color: 'rgba(244,120,32,0.06)',
                  lineHeight: 1, userSelect: 'none',
                }}>
                  {p.num}
                </div>

                <div style={{ marginBottom: '1.25rem' }}>{p.icon}</div>
                <h3 style={{ marginBottom: '0.3rem' }}>{p.label}</h3>
                <div style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  color: 'var(--text)',
                  marginBottom: '0.85rem',
                  lineHeight: 1.3,
                }}>
                  {p.title}
                </div>
                <p style={{ fontSize: '0.87rem', color: 'var(--text-2)', lineHeight: 1.65 }}>
                  {p.desc}
                </p>
                <div style={{
                  marginTop: '1.75rem',
                  fontSize: '0.75rem',
                  color: 'var(--orange)',
                  letterSpacing: '0.1em',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}>
                  Enter Portal →
                </div>
              </div>
            </a>
          ))}
        </div>
      </section>

      <div className="divider" />

      {/* ── How It Works ────────────────────────────────────────── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '6rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <div className="eyebrow">Protocol Flow</div>
          <h2 style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 'clamp(1.8rem, 4vw, 2.6rem)',
            fontWeight: 600,
            marginTop: '0.5rem',
          }}>
            From invoice to yield in three steps.
          </h2>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '0',
          position: 'relative',
        }}>
          {STEPS.map((s, i) => (
            <div key={s.n} style={{ display: 'flex', gap: '1.5rem', padding: '2rem' }}>
              {/* Step number */}
              <div style={{
                width: 40, height: 40,
                borderRadius: '50%',
                background: 'var(--orange)',
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.85rem', fontWeight: 500,
                flexShrink: 0,
              }}>
                {s.n}
              </div>
              <div>
                <div style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: '1.2rem',
                  fontWeight: 600,
                  color: 'var(--text)',
                  marginBottom: '0.6rem',
                }}>
                  {s.title}
                </div>
                <p style={{ fontSize: '0.87rem', color: 'var(--text-2)', lineHeight: 1.7 }}>
                  {s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="divider" />

      {/* ── Footer CTA ──────────────────────────────────────────── */}
      <section style={{
        maxWidth: 1080, margin: '0 auto',
        padding: '5rem 2rem 6rem',
        textAlign: 'center',
      }}>
        <div className="eyebrow" style={{ marginBottom: '1rem' }}>kyro.cash</div>
        <h2 style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 'clamp(1.5rem, 3.5vw, 2.2rem)',
          fontWeight: 600,
          marginBottom: '1rem',
        }}>
          Ready to explore the protocol?
        </h2>
        <p style={{ color: 'var(--text-2)', marginBottom: '2.5rem', fontSize: '0.95rem' }}>
          Kyro runs on ADI Testnet (Chain ID 99999). Connect MetaMask to interact.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/sme" className="btn btn-primary" style={{ width: 'auto', margin: 0 }}>Get Started</a>
          <a
            href="https://explorer.ab.testnet.adifoundation.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            style={{ margin: 0 }}
          >
            View Explorer ↗
          </a>
        </div>
      </section>

    </div>
  )
}
