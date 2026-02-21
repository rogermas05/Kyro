'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLinks() {
  const path = usePathname()
  return (
    <>
      <Link href="/sme"      className={path.startsWith('/sme')      ? 'nav-active' : ''}>SME</Link>
      <Link href="/investor" className={path.startsWith('/investor') ? 'nav-active' : ''}>Investor</Link>
      <Link href="/auditor"  className={path.startsWith('/auditor')  ? 'nav-active' : ''}>Auditor</Link>
    </>
  )
}
