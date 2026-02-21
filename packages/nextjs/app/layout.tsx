import type { Metadata } from 'next'
import './globals.css'
import { FaucetButton } from './components/FaucetButton'

export const metadata: Metadata = {
  title: 'Kyro — Invoice Finance, On-Chain',
  description: 'Kyro tokenizes trade invoices into compliant, liquid RWA instruments. ERC-4626 vault, ZK-verified compliance, powered by ADI Chain.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isLocal = process.env.NEXT_PUBLIC_USE_LOCAL === 'true'

  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/" className="brand">
            <em>Kyro</em>
          </a>
          <a href="/sme">SME</a>
          <a href="/investor">Investor</a>
          <a href="/auditor">Auditor</a>
          <a href="/merchant">Merchant</a>
          {isLocal && <FaucetButton />}
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
