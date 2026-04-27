import { getAuditTail, getRecentRuns } from '@/lib/read-model';
import { Card } from '@/components/ui';
import { RefreshButton } from '@/components/RefreshButton';

export const dynamic = 'force-dynamic';

export default async function AdminRefreshPage() {
  const runs = await getRecentRuns(20);
  const audit = await getAuditTail(80);

  // Compute per-source freshness from the most recent successful run.
  const lastSuccess = runs.find((r) => r.status === 'success' || r.status === 'partial');
  const sources = lastSuccess
    ? (lastSuccess.sources_succeeded as string[])
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Refresh Status & Audit</h1>
        <RefreshButton />
      </div>

      <Card title="Source freshness">
        {!lastSuccess ? (
          <p className="text-sm text-gray-500">No successful runs yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {sources.map((s) => (
              <li key={s} className="rounded border border-gray-200 px-2 py-1">
                <div className="text-xs text-gray-500">{s}</div>
                <div>
                  {lastSuccess.completed_at
                    ? new Date(lastSuccess.completed_at).toLocaleString()
                    : '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent refresh runs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Scoring</th>
                <th className="px-3 py-2">Sources</th>
                <th className="px-3 py-2">Rows</th>
                <th className="px-3 py-2">Errors</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-xs text-gray-700">{new Date(r.started_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${
                      r.status === 'success' ? 'bg-green-100 text-green-800'
                      : r.status === 'partial' ? 'bg-yellow-100 text-yellow-800'
                      : r.status === 'running' ? 'bg-blue-100 text-blue-800'
                      : 'bg-red-100 text-red-800'
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.scoring_version}</td>
                  <td className="px-3 py-2 text-xs">
                    {(r.sources_succeeded ?? []).length}/{(r.sources_attempted ?? []).length}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.row_counts ? `${(r.row_counts as Record<string, number>).accounts ?? 0}a / ${(r.row_counts as Record<string, number>).opportunities ?? 0}o` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-red-700">
                    {r.error_log ? JSON.stringify(r.error_log).slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Audit log (most recent)">
        <ul className="space-y-1 text-xs">
          {audit.map((a) => (
            <li key={a.id} className="border-b border-gray-100 py-1">
              <span className="text-gray-500">{new Date(a.occurred_at).toLocaleString()}</span>{' '}
              <span className="rounded bg-gray-100 px-1">{a.actor}</span>{' '}
              <span className="font-medium">{a.event}</span>
              {a.details ? (
                <span className="ml-2 text-gray-600">{JSON.stringify(a.details).slice(0, 200)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
