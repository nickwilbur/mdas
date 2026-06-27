import Link from 'next/link';
import { compareCseSnapshots, listCseSnapshots } from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default async function CseComparePage({
  searchParams,
}: {
  searchParams: Promise<{ current?: string; prior?: string }>;
}) {
  const { current, prior } = await searchParams;
  const snapshots = listCseSnapshots();
  const currentDate = current ?? snapshots[0] ?? null;
  const priorDate = prior ?? (currentDate ? snapshots.find((d) => d < currentDate) : null) ?? null;
  const comparison =
    currentDate != null ? compareCseSnapshots(currentDate, priorDate ?? undefined) : null;

  return (
    <div className="space-y-4">
      <Link href="/admin/cse-activity" className="text-sm text-blue-700 underline">
        ← CSE Activity
      </Link>
      <h1 className="text-2xl font-semibold">Week-over-week comparison</h1>
      {snapshots.length < 2 ? (
        <p className="text-sm text-gray-600">Generate at least two weekly snapshots to compare trends.</p>
      ) : (
        <>
          <form className="flex flex-wrap items-end gap-3 text-sm" action="/admin/cse-activity/compare" method="get">
            <label>
              Current
              <select name="current" defaultValue={currentDate ?? ''} className="ml-2 rounded border px-2 py-1">
                {snapshots.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prior
              <select name="prior" defaultValue={priorDate ?? ''} className="ml-2 rounded border px-2 py-1">
                {snapshots.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded bg-gray-800 px-3 py-1.5 text-white">
              Compare
            </button>
          </form>
          {comparison && (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
              <p>
                <strong>{comparison.currentSnapshotDate}</strong> vs{' '}
                <strong>{comparison.priorSnapshotDate ?? '—'}</strong>
              </p>
              <ul className="list-disc pl-5">
                {comparison.narrative.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <table className="min-w-full border-collapse text-left">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-2 py-1">Metric</th>
                    <th className="border px-2 py-1">Δ vs prior week</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(comparison.deltas).map(([k, v]) => (
                    <tr key={k}>
                      <td className="border px-2 py-1">{k}</td>
                      <td className="border px-2 py-1 tabular-nums">{v ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
