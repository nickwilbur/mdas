import Link from 'next/link';
import { CseActivityActions } from '@/components/CseActivityHub';
import { RefreshButton } from '@/components/RefreshButton';
import { loadCseActivityConfig } from '@/lib/cse-activity/config';
import {
  getGleanMcpFreshnessSummary,
  getInferredTeamFromViews,
  getCseSnapshot,
  gleanMcpNeedsRefreshWarning,
  listCseSnapshots,
} from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default async function CseActivityHubPage() {
  const snapshots = listCseSnapshots();
  const latest = snapshots[0] ?? null;
  const config = loadCseActivityConfig();
  const [inferredTeam, gleanFreshness] = await Promise.all([
    getInferredTeamFromViews(),
    getGleanMcpFreshnessSummary(),
  ]);
  const latestMeta = latest ? getCseSnapshot(latest)?.metadata : null;
  const needsGleanRefresh = gleanMcpNeedsRefreshWarning(gleanFreshness);
  const gleanOkAfterRefresh =
    !needsGleanRefresh && gleanFreshness.latestRefresh?.gleanMcpRan === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">CSE Activity Dashboard</h1>
          <p className="text-sm text-gray-600">
            Internal manager weekly snapshots — Friday EOD ({config.timezone}), 7-day window. Not for
            leadership distribution yet.
          </p>
        </div>
        <CseActivityActions latestSnapshot={latest} />
      </div>

      {needsGleanRefresh && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p>
            Glean calendar/Slack has not been queried recently for{' '}
            <strong>
              {gleanFreshness.staleCount + gleanFreshness.neverEnrichedCount}/
              {gleanFreshness.expand3Total}
            </strong>{' '}
            Expand 3 accounts ({gleanFreshness.staleCount} older than 7 days,{' '}
            {gleanFreshness.neverEnrichedCount} never queried). Run <strong>MDAS Refresh</strong>{' '}
            before generating the weekly snapshot.
          </p>
          <RefreshButton />
        </div>
      )}

      {gleanOkAfterRefresh && gleanFreshness.emptyAfterRefreshCount > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          Latest MDAS Refresh queried Glean successfully.{' '}
          <strong>{gleanFreshness.emptyAfterRefreshCount}</strong> accounts have no indexed
          calendar/Slack touchpoints in the reporting window — that is a data gap in Glean, not a
          stale refresh.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-500">Latest snapshot</h2>
          <p className="mt-1 text-lg font-medium">{latest ?? 'None yet'}</p>
          {latestMeta && (
            <p className="mt-1 text-xs text-gray-500">
              Status {latestMeta.overallStatus} · Coverage {latestMeta.dataCoverage}
            </p>
          )}
          {latest && (
            <Link
              href={`/admin/cse-activity/snapshots/${latest}`}
              className="mt-2 inline-block text-sm font-medium text-blue-700 underline"
            >
              Open manager dashboard →
            </Link>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-500">Team members</h2>
          <p className="mt-1 text-lg font-medium">{inferredTeam.length}</p>
          <p className="mt-1 text-xs text-gray-500">Inferred from Expand 3 assigned CSEs in MDAS</p>
          <Link
            href="/admin/cse-activity/config"
            className="mt-2 inline-block text-sm font-medium text-blue-700 underline"
          >
            View configuration →
          </Link>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-500">Glean enrichment</h2>
          <p className="mt-1 text-lg font-medium">
            {gleanFreshness.freshCount}/{gleanFreshness.expand3Total} fresh
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {gleanFreshness.latestRefresh?.gleanMcpRan
              ? 'Queried on latest MDAS Refresh — same 7-day freshness window as Data Quality'
              : 'Run MDAS Refresh (glean-mcp) — snapshots read this cache'}
          </p>
          <RefreshButton />
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-500">Executive brief</h2>
          <p className="mt-1 text-sm text-gray-700">Expand 3 renewal, churn & upsell — weekly CSE leadership view</p>
          <Link
            href="/admin/leadership"
            className="mt-2 inline-block text-sm font-medium text-blue-700 underline"
          >
            Open executive dashboard →
          </Link>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Saved snapshots</h2>
          {snapshots.length >= 2 && (
            <Link
              href={`/admin/cse-activity/compare?current=${snapshots[0]}&prior=${snapshots[1]}`}
              className="text-sm text-blue-700 underline"
            >
              Compare latest two weeks
            </Link>
          )}
        </div>
        {snapshots.length === 0 ? (
          <p className="text-sm text-gray-600">
            No snapshots yet. Click <strong>Generate weekly snapshot</strong> to create the first
            Friday EOD point-in-time package from MDAS, CTAs, and configured sources.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {snapshots.map((date) => {
              const meta = getCseSnapshot(date)?.metadata;
              return (
                <li key={date} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-medium">{date}</span>
                    {meta && (
                      <span className="ml-2 text-gray-500">
                        {meta.overallStatus} · {meta.strategicPosture} · {meta.dataCoverage} coverage
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <Link href={`/admin/cse-activity/snapshots/${date}`} className="text-blue-700 underline">
                      Dashboard
                    </Link>
                    <Link
                      href={`/admin/cse-activity/snapshots/${date}/team`}
                      className="text-blue-700 underline"
                    >
                      Team reports
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
