import Link from 'next/link';
import { getDashboardData } from '@/lib/read-model';
import { BucketBadge, Card, RiskBadge, SentimentBadge, StatTile, UpsellBandBadge, fmtUSD } from '@/components/ui';
import { RefreshButton } from '@/components/RefreshButton';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { views, refreshId, startedAt } = await getDashboardData();

  if (!refreshId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">No data yet</h1>
        <p className="text-gray-700">Run <code>make seed</code> or click Refresh.</p>
        <RefreshButton />
      </div>
    );
  }

  const totalAccounts = views.length;
  const totalATR = views.reduce((s, v) => s + v.atrUSD, 0);
  const acvAtRisk = views.reduce((s, v) => s + v.acvAtRiskUSD, 0);

  const byRisk = { Critical: 0, High: 0, Medium: 0, Low: 0, Unknown: 0 } as Record<string, number>;
  for (const v of views) byRisk[v.risk.level ?? 'Unknown']! += 1;

  const bySent = { Green: 0, Yellow: 0, Red: 0, 'Confirmed Churn': 0, Unset: 0 } as Record<string, number>;
  for (const v of views) bySent[v.account.cseSentiment ?? 'Unset']! += 1;

  const confirmed = views.filter((v) => v.bucket === 'Confirmed Churn');
  const saveable = views.filter((v) => v.bucket === 'Saveable Risk');
  const upsell = views
    .filter((v) => v.upsell.band === 'Hot' || v.upsell.band === 'Active')
    .sort((a, b) => b.upsell.score - a.upsell.score);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Manager Dashboard</h1>
          <p className="text-xs text-gray-500">
            Last refresh: {startedAt ? new Date(startedAt).toLocaleString() : '—'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/forecast" className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium shadow-sm">
            Generate Weekly Forecast Update
          </Link>
          <RefreshButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Accounts" value={totalAccounts} />
        <StatTile label="Total ATR" value={fmtUSD(totalATR)} />
        <StatTile label="ACV at Risk" value={fmtUSD(acvAtRisk)} />
        <StatTile label="Risk: Critical/High" value={`${byRisk.Critical}/${byRisk.High}`} sub={`Med ${byRisk.Medium} • Low ${byRisk.Low}`} />
        <StatTile label="Sentiment R/Y/G" value={`${bySent.Red}/${bySent.Yellow}/${bySent.Green}`} sub={`Churn ${bySent['Confirmed Churn']}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={`Confirmed Churn (${confirmed.length})`}>
          <ul className="space-y-2 text-sm">
            {confirmed.length === 0 && <li className="text-gray-500">None.</li>}
            {confirmed.map((v) => (
              <li key={v.account.accountId} className="flex items-center justify-between">
                <Link href={`/accounts/${v.account.accountId}`} className="font-medium hover:underline">
                  {v.account.accountName}
                </Link>
                <span className="tabular-nums text-red-700">{fmtUSD(v.acvAtRiskUSD)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Saveable Risk (${saveable.length})`}>
          <ul className="space-y-2 text-sm">
            {saveable.length === 0 && <li className="text-gray-500">None.</li>}
            {saveable.map((v) => (
              <li key={v.account.accountId} className="flex items-center justify-between gap-2">
                <Link href={`/accounts/${v.account.accountId}`} className="font-medium hover:underline">
                  {v.account.accountName}
                </Link>
                <div className="flex items-center gap-2">
                  <RiskBadge level={v.risk.level} source={v.risk.source} />
                  <span className="tabular-nums text-gray-700">{fmtUSD(v.atrUSD)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Upsell Hot/Active (${upsell.length})`}>
          <ul className="space-y-2 text-sm">
            {upsell.length === 0 && <li className="text-gray-500">None.</li>}
            {upsell.map((v) => (
              <li key={v.account.accountId} className="flex items-center justify-between gap-2">
                <Link href={`/accounts/${v.account.accountId}`} className="font-medium hover:underline">
                  {v.account.accountName}
                </Link>
                <div className="flex items-center gap-2">
                  <UpsellBandBadge band={v.upsell.band} score={v.upsell.score} />
                  <SentimentBadge value={v.account.cseSentiment} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
