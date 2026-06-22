'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  {
    href: '/renewals',
    label: 'Scorecard',
    description: 'Retention performance, trends, and plan vs flash',
  },
  {
    href: '/renewal-analysis',
    label: 'Workbench',
    description: 'Manage the forward pipeline and review quarter close',
  },
] as const;

/**
 * Sub-navigation for the Renewals area. One nav item ("Renewals") in the
 * global header; Scorecard vs Workbench clarifies executive summary vs
 * operational drill-down without two confusing top-level links.
 */
export function RenewalNav() {
  const pathname = usePathname();
  const active = pathname.startsWith('/renewal-analysis') ? '/renewal-analysis' : '/renewals';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm shadow-sm"
        role="tablist"
        aria-label="Renewals views"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active === tab.href}
            className={`rounded-md px-3 py-1.5 font-medium ${
              active === tab.href
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            title={tab.description}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        {TABS.find((t) => t.href === active)?.description}
      </p>
    </div>
  );
}
