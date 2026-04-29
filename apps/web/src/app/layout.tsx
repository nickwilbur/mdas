import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { GleanStatusBadge } from '@/components/GleanStatusBadge';

export const metadata = {
  title: 'MDAS — Expand 3',
  description: "Manager's Dashboard and Decision Support System",
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/wow', label: 'WoW' },
  { href: '/hygiene', label: 'Hygiene' },
  { href: '/forecast', label: 'Forecast' },
  { href: '/glean', label: 'Glean' },
  { href: '/admin/data-quality', label: 'Data Quality' },
  { href: '/admin/refresh', label: 'Refresh' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
          <div className="mx-auto flex w-full items-center gap-6 px-6 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              MDAS <span className="text-xs font-normal text-gray-500">Expand 3</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-gray-700 hover:text-black">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto">
              <GleanStatusBadge />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
