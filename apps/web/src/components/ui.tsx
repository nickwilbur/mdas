import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { CerebroRiskCategory, CSESentiment } from '@mdas/canonical';

export const fmtUSD = (n: number | null | undefined) =>
  n == null ? '—' : n === 0 ? '$0' : `$${Math.round(n).toLocaleString('en-US')}`;

export function RiskBadge({
  level,
  source,
}: {
  level: CerebroRiskCategory | 'Unknown';
  source: 'cerebro' | 'fallback';
}) {
  const colors: Record<string, string> = {
    Critical: 'bg-red-600 text-white',
    High: 'bg-orange-600 text-white',
    Medium: 'bg-yellow-500 text-black',
    Low: 'bg-green-600 text-white',
    Unknown: 'bg-gray-400 text-white',
  };
  const text = level ?? 'Unknown';
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx('rounded px-2 py-0.5 text-xs font-semibold', colors[text])}>
        {text}
      </span>
      <span className="text-[10px] uppercase text-gray-500">via {source}</span>
    </span>
  );
}

export function SentimentBadge({ value }: { value: CSESentiment }) {
  const colors: Record<string, string> = {
    Green: 'bg-green-100 text-green-800 ring-green-300',
    Yellow: 'bg-yellow-100 text-yellow-800 ring-yellow-300',
    Red: 'bg-red-100 text-red-800 ring-red-300',
    'Confirmed Churn': 'bg-black text-white ring-gray-700',
  };
  if (!value) return <span className="text-gray-400">—</span>;
  return (
    <span className={clsx('rounded px-2 py-0.5 text-xs ring-1', colors[value])}>{value}</span>
  );
}

export function BucketBadge({ bucket }: { bucket: string }) {
  const colors: Record<string, string> = {
    'Confirmed Churn': 'bg-black text-white',
    'Saveable Risk': 'bg-orange-100 text-orange-800 ring-1 ring-orange-300',
    Healthy: 'bg-green-100 text-green-800 ring-1 ring-green-300',
  };
  return <span className={clsx('rounded px-2 py-0.5 text-xs', colors[bucket])}>{bucket}</span>;
}

export function UpsellBandBadge({ band, score }: { band: string; score: number }) {
  const colors: Record<string, string> = {
    Hot: 'bg-pink-600 text-white',
    Active: 'bg-violet-600 text-white',
    Qualified: 'bg-blue-100 text-blue-800',
    Watch: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', colors[band])}>
      {band} {score}
    </span>
  );
}

export function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-gray-500">{sub}</div> : null}
    </div>
  );
}
