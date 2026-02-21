import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { FaucetButton } from './components/FaucetButton'
import { NavLinks } from './components/NavLinks'
import { WalletProvider } from './context/WalletContext'
import { WalletButton } from './components/WalletButton'

export const metadata: Metadata = {
  title: 'Kyro — Invoice Finance, On-Chain',
  description: 'Kyro tokenizes trade invoices into compliant, liquid RWA instruments. ERC-4626 vault, ZK-verified compliance, powered by ADI Chain.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isLocal = process.env.NEXT_PUBLIC_USE_LOCAL === 'true'

  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <nav>
            <Link href="/" className="brand">
              <em>Kyro</em>
            </Link>
            <NavLinks />
            {isLocal && <FaucetButton />}
            <WalletButton />
          </nav>
          <main>{children}</main>
        </WalletProvider>
      </body>
    </html>
  )
}
