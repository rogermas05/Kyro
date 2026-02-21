import { ProtocolStats } from './components/ProtocolStats'

const PORTALS = [
  {
    num: '01',
    label: 'SME Portal',
    title: 'Get Cash From Your Invoices',
    desc: 'Upload an invoice, get it oracle-verified, and receive DDSC stablecoin to your wallet immediately. No waiting 30–90 days for the buyer to pay. No bank required.',
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
    title: 'Earn Real-World Yield',
    desc: 'Deposit DDSC into the trade finance vault and earn yield as invoices are repaid by real buyers. Your returns are backed by real commerce — not speculation.',
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
    label: 'Auditor Portal',
    title: 'Track Compliance On-Chain',
    desc: 'A live, immutable log of every invoice — from creation to settlement. Full on-chain transparency for compliance teams, verifiable by anyone.',
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
    desc: 'SME submits invoice details and uploads the document. An off-chain oracle attests to the invoice — in production it checks buyer creditworthiness and trade records before signing. Only a document hash goes on-chain; the file stays private.',
  },
  {
    n: '2',
    title: 'Tokenize & Fund',
    desc: 'Your verified invoice becomes an on-chain NFT. 80% of the face value flows into the vault as collateral — and you receive DDSC to your wallet instantly. No banks. No delays.',
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

      {/* ── Hero + Stats (full viewport) ───────────────────────── */}
      <div style={{ height: 'calc(100vh - var(--nav-h))', display: 'flex', flexDirection: 'column' }}>
      <section style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        maxWidth: 1080,
        margin: '0 auto',
        width: '100%',
        padding: '4rem 2rem 3rem',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Floating gradient orb */}
        <div className="float" style={{
          position: 'absolute',
          top: '8%', left: '-10%',
          width: 600, height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(244,120,32,0.09) 0%, rgba(0,53,95,0.12) 50%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
          animationDuration: '7s',
        }} />
        <div className="float" style={{
          position: 'absolute',
          bottom: '5%', right: '-5%',
          width: 400, height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,53,95,0.2) 0%, transparent 65%)',
          pointerEvents: 'none',
          zIndex: 0,
          animationDuration: '9s',
          animationDelay: '-3s',
        }} />

        <div className="eyebrow fade-up" style={{ marginBottom: '1.75rem', position: 'relative', zIndex: 1 }}>
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
          position: 'relative', zIndex: 1,
        }}>
          Invoice Finance,<br />
          <em className="glow-pulse" style={{ color: 'var(--orange)', fontStyle: 'italic' }}>Reimagined.</em><br />
          <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>Liquid. Yielding.</span>
        </h1>

        <p className="fade-up-2" style={{
          color: 'var(--text-2)',
          fontSize: '1.05rem',
          lineHeight: 1.8,
          maxWidth: 520,
          marginBottom: '2.75rem',
          position: 'relative', zIndex: 1,
        }}>
          SMEs upload their outstanding invoices and receive DDSC stablecoin immediately —
          no 30-day wait, no banks. Investors earn real yield as those invoices are repaid
          by buyers. Every step is transparent and verifiable on ADI Chain.
        </p>

        <div className="fade-up-3" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '3.5rem', position: 'relative', zIndex: 1 }}>
          <a href="/investor" className="btn btn-primary" style={{ width: 'auto', margin: 0 }}>
            Investor Portal
          </a>
          <a href="/sme" className="btn btn-secondary" style={{ margin: 0 }}>
            SME Onboarding
          </a>
        </div>

        {/* Tech stack badges */}
        <div className="fade-up-4" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
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
      <ProtocolStats />
      </div>

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
            Three roles. One protocol.
          </h2>
          <p style={{ color: 'var(--text-2)', marginTop: '0.75rem', fontSize: '0.95rem' }}>
            From invoice upload to yield withdrawal — every role has a dedicated portal.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '1.25rem',
        }}>
          {PORTALS.map((p) => {
            const featured = p.href === '/sme' || p.href === '/investor'
            return (
            <a key={p.href} href={p.href} style={{ textDecoration: 'none', display: 'block' }}>
              <div className="card" style={{
                height: '100%', position: 'relative', overflow: 'hidden', cursor: 'pointer',
                ...(featured ? {
                  borderColor: 'rgba(244,120,32,0.22)',
                  background: 'linear-gradient(135deg, rgba(0,53,95,0.45) 0%, rgba(0,30,50,0.5) 100%)',
                } : { opacity: 0.75 }),
              }}>
                <div style={{
                  position: 'absolute', top: '1rem', right: '1.25rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '3rem', fontWeight: 500,
                  color: featured ? 'rgba(244,120,32,0.09)' : 'rgba(244,120,32,0.05)',
                  lineHeight: 1, userSelect: 'none',
                }}>
                  {p.num}
                </div>
                {featured && (
                  <div style={{
                    position: 'absolute', top: '0.85rem', left: 0,
                    width: 3, height: '55%', borderRadius: '0 2px 2px 0',
                    background: 'linear-gradient(180deg, var(--orange) 0%, transparent 100%)',
                  }} />
                )}
                <div style={{ marginBottom: '1.25rem' }}>{p.icon}</div>
                <h3 style={{ marginBottom: '0.3rem' }}>{p.label}</h3>
                <div style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: '1.25rem', fontWeight: 600,
                  color: 'var(--text)', marginBottom: '0.85rem', lineHeight: 1.3,
                }}>{p.title}</div>
                <p style={{ fontSize: '0.87rem', color: 'var(--text-2)', lineHeight: 1.65 }}>{p.desc}</p>
                <div style={{
                  marginTop: '1.75rem', fontSize: '0.75rem',
                  color: featured ? 'var(--orange)' : 'var(--muted)',
                  letterSpacing: '0.1em', fontWeight: 600, textTransform: 'uppercase',
                }}>
                  Enter Portal →
                </div>
              </div>
            </a>
            )
          })}
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
          Stop waiting to get paid.
        </h2>
        <p style={{ color: 'var(--text-2)', marginBottom: '2.5rem', fontSize: '0.95rem' }}>
          Kyro turns outstanding invoices into instant liquidity — live on ADI Testnet. Connect your wallet and try it yourself.
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
