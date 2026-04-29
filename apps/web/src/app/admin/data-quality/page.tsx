// /admin/data-quality — per-source and per-field staleness ranked by ARR.
//
// Audit ref: F-06 in docs/audit/01_findings.md.
//
// Persona ask: "which Tier-1 ARR accounts have stale Cerebro analysis
// older than 7 days?" Answer is now reachable in one query and one click.
import { getDataQuality } from '@/lib/read-model';
import { Card, RelativeTime, StatTile, fmtUSD } from '@/components/ui';
import { RefreshButton } from '@/components/RefreshButton';

export const dynamic = 'force-dynamic';

const STATE_COLOR: Record<'fresh' | 'stale' | 'error' | 'missing', string> = {
  fresh: 'text-emerald-700 bg-emerald-50',
  stale: 'text-amber-800 bg-amber-50',
  error: 'text-red-800 bg-red-50',
  missing: 'text-gray-600 bg-gray-100',
};

export default async function DataQualityPage(): Promise<JSX.Element> {
  const dq = await getDataQuality();

  if (!dq.refreshId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Data Quality</h1>
        <p className="text-sm text-gray-600">
          No successful refresh yet. Run a refresh to populate this page.
        </p>
        <RefreshButton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Data Quality</h1>
          <p className="text-xs text-gray-500">
            Latest refresh: <RelativeTime iso={dq.startedAt} /> ·{' '}
            {dq.totalAccounts} Expand 3 accounts · {fmtUSD(dq.totalARR)} ARR
          </p>
        </div>
        <RefreshButton />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Accounts" value={dq.totalAccounts} />
        <StatTile label="Total ARR" value={fmtUSD(dq.totalARR)} />
        <StatTile
          label="Sources tracked"
          value={dq.perSource.length}
          sub="incl. expected adapters with no data"
        />
        <StatTile
          label="Field rules"
          value={dq.perField.length}
          sub="critical-data presence checks"
        />
      </div>

      <Card title="Per-source freshness × ARR">
        <p className="mb-3 text-xs text-gray-600">
          For each source, accounts are bucketed by how recently the source
          enriched them this refresh. ARR is the sum of{' '}
          <code>allTimeARR</code> across the bucket. Stale = older than 7
          days; Error = adapter recorded a non-fatal failure; Missing = no
          entry at all.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Fresh</th>
                <th className="px-3 py-2 text-right">Fresh ARR</th>
                <th className="px-3 py-2 text-right">Stale</th>
                <th className="px-3 py-2 text-right">Stale ARR</th>
                <th className="px-3 py-2 text-right">Error</th>
                <th className="px-3 py-2 text-right">Error ARR</th>
                <th className="px-3 py-2 text-right">Missing</th>
                <th className="px-3 py-2 text-right">Missing ARR</th>
                <th className="px-3 py-2 text-right">At-risk ARR</th>
              </tr>
            </thead>
            <tbody>
              {dq.perSource.map((s) => {
                const atRiskArr = s.stale.arr + s.error.arr + s.missing.arr;
                return (
                  <tr key={s.source} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium">{s.source}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${STATE_COLOR.fresh}`}>
                      {s.fresh.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(s.fresh.arr)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${STATE_COLOR.stale}`}>
                      {s.stale.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(s.stale.arr)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${STATE_COLOR.error}`}>
                      {s.error.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(s.error.arr)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${STATE_COLOR.missing}`}>
                      {s.missing.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(s.missing.arr)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-800">
                      {fmtUSD(atRiskArr)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Critical-field presence × ARR">
        <p className="mb-3 text-xs text-gray-600">
          Each row is a canonical-field rule. Missing = the field is empty
          on the account (or on every open opportunity, where the rule
          applies at the opp level). Sorted by ARR-exposed descending.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2 text-right">Missing accts</th>
                <th className="px-3 py-2 text-right">Of total</th>
                <th className="px-3 py-2 text-right">ARR exposed</th>
              </tr>
            </thead>
            <tbody>
              {dq.perField.map((f) => (
                <tr key={f.field} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs">{f.field}</td>
                  <td className="px-3 py-2 text-gray-700">{f.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.missingCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    /{f.total}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-800">
                    {fmtUSD(f.missingARR)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
