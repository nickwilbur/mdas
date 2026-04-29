import Link from 'next/link';
import { getDashboardData, getWoWChangeEvents } from '@/lib/read-model';
import {
  BucketBadge,
  Card,
  RelativeTime,
  RiskBadge,
  RiskScoreBadge,
  SentimentBadge,
  StatTile,
  UpsellBandBadge,
  fmtUSD,
} from '@/components/ui';
import { RefreshButton } from '@/components/RefreshButton';
import { ActionQueue } from '@/components/ActionQueue';
import { MovementsStrip } from '@/components/MovementsStrip';
import { FiscalQuarterFilter } from '@/components/FiscalQuarterFilter';
import {
  fiscalQuarterFromDate,
  fiscalQuartersForAccount,
  parseQuartersParam,
} from '@/lib/fiscal';

export const dynamic = 'force-dynamic';

// Audit ref: F-04 in docs/audit/01_findings.md.
//
// Redesigned 2026-04-28 (PR-A9): the prior layout led with five
// stat tiles and three bucket lists — a CFO-style snapshot. The persona
// ask is "what changed in my book this week, and what do I need to do
// about it?" The new layout reorders to: ActionQueue → MovementsStrip
// → roll-up tiles → bucket lists. The roll-up data is preserved (not
// removed) so muscle memory still works for managers who scroll past
// the action items.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ quarters?: string }>;
}) {
  const { quarters } = await searchParams;
  // Load both feeds in parallel so the ActionQueue can rank by
  // movement-this-week without an extra database round trip.
  const [{ views: allViews, refreshId, startedAt }, wow] = await Promise.all([
    getDashboardData(),
    getWoWChangeEvents(),
  ]);

  if (!refreshId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">No data yet</h1>
        <p className="text-gray-700">
          Run <code>make seed</code> or click Refresh.
        </p>
        <RefreshButton />
      </div>
    );
  }

  // Apply fiscal quarter filter (URL-driven). Empty / "__none__" sentinel
  // intentionally yields zero rows so the user sees their selection
  // reflected literally rather than silently snapping back to all.
  const selectedQuarters = parseQuartersParam(quarters);
  const availableQuarterKeys = Array.from(
    new Set(allViews.flatMap((v) => fiscalQuartersForAccount(v))),
  );
  const views =
    selectedQuarters === null
      ? allViews
      : allViews.filter((v) => {
          const ks = fiscalQuartersForAccount(v);
          return ks.some((k) => selectedQuarters.has(k));
        });

  // Quarter-scoped metrics. We must apply the same canonical formulas used
  // by packages/scoring (atrUSD = Σ availableToRenewUSD; acvAtRiskUSD, gated
  // on bucket !== 'Healthy', = Σ |knownChurnUSD| + max(0, -acvDelta)) but
  // restrict the summed opportunities to those whose close-quarter is in
  // the selection. Without quarter filtering we fall through to the
  // pre-computed account-level totals.
  const totalAccounts = views.length;
  let totalATR = 0;
  let acvAtRisk = 0;

  if (selectedQuarters === null) {
    totalATR = views.reduce((s, v) => s + v.atrUSD, 0);
    acvAtRisk = views.reduce((s, v) => s + v.acvAtRiskUSD, 0);
  } else {
    for (const v of views) {
      const oppsInQuarter = v.opportunities.filter((o) => {
        const fq = fiscalQuarterFromDate(o.closeDate);
        return fq !== null && selectedQuarters.has(fq.key);
      });

      // ATR — straight sum of availableToRenewUSD over in-quarter opps.
      totalATR += oppsInQuarter.reduce(
        (s, o) => s + (o.availableToRenewUSD ?? 0),
        0,
      );

      // ACV at Risk — gated by account bucket. For Confirmed Churn accounts
      // bucketed into this quarter via their churn date, the relevant opps
      // may have closeDates outside the quarter (or be empty), so fall back
      // to the full opp set so we don't drop the known churn dollars.
      if (v.bucket === 'Healthy') continue;
      const isConfirmedChurnInQuarter =
        v.bucket === 'Confirmed Churn' &&
        (() => {
          const fq = fiscalQuarterFromDate(v.account.churnDate);
          return fq !== null && selectedQuarters.has(fq.key);
        })();
      const oppsForAcvAtRisk = isConfirmedChurnInQuarter
        ? v.opportunities
        : oppsInQuarter;
      acvAtRisk += oppsForAcvAtRisk.reduce(
        (s, o) =>
          s + Math.abs(o.knownChurnUSD ?? 0) + Math.max(0, -(o.acvDelta ?? 0)),
        0,
      );
    }
  }

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
            Last refresh: <RelativeTime iso={startedAt} />
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/forecast"
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium shadow-sm"
          >
            Generate Quarterly Forecast Update
          </Link>
          <RefreshButton />
        </div>
      </div>

      <FiscalQuarterFilter availableQuarterKeys={availableQuarterKeys} />

      {/* PR-A9: Movements strip — compressed WoW so the manager sees the
          "what changed" answer without leaving the page. */}
      <MovementsStrip events={wow.events} prevId={wow.prevId} currId={wow.currId} />

      {/* Roll-up tiles: same data as before, demoted below the new
          attention-direction surfaces. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Accounts" value={totalAccounts} />
        <StatTile label="Total ATR" value={fmtUSD(totalATR)} />
        <StatTile label="ACV at Risk" value={fmtUSD(acvAtRisk)} />
        <StatTile
          label="Risk: Critical/High"
          value={`${byRisk.Critical}/${byRisk.High}`}
          sub={`Med ${byRisk.Medium} • Low ${byRisk.Low}`}
        />
        <StatTile
          label="Sentiment R/Y/G"
          value={`${bySent.Red}/${bySent.Yellow}/${bySent.Green}`}
          sub={`Churn ${bySent['Confirmed Churn']}`}
        />
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
                  {v.riskScore ? (
                    <RiskScoreBadge
                      score={v.riskScore.score}
                      band={v.riskScore.band}
                      confidence={v.riskScore.confidence}
                    />
                  ) : (
                    <RiskBadge level={v.risk.level} source={v.risk.source} />
                  )}
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

      {/* PR-A9: Action queue moved to bottom per user feedback */}
      <section aria-labelledby="action-queue-heading" className="space-y-2">
        <div className="flex items-end justify-between">
          <h2 id="action-queue-heading" className="text-lg font-semibold">
            Your next 5 actions
          </h2>
          <Link href="/accounts" className="text-xs text-blue-700 hover:underline">
            All accounts →
          </Link>
        </div>
        <ActionQueue views={views} events={wow.events} limit={5} />
      </section>
    </div>
  );
}
