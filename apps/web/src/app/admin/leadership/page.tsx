import Link from 'next/link';
import {
  LeadershipPdfButton,
  LeadershipPrintButton,
} from '@/components/leadership/LeadershipPdfButton';
import { LeadershipDashboard } from '@/components/LeadershipDashboard';
import { latestWeeklyReportSlug } from '@/lib/leadership/parse-report';
import { listLeadershipReports, readLeadershipReport } from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default function LeadershipReportsIndexPage() {
  const reports = listLeadershipReports();
  const latestWeeklySlug = latestWeeklyReportSlug(reports);
  const latestMd = latestWeeklySlug ? readLeadershipReport(latestWeeklySlug) : null;
  const supplements = reports.filter((r) => r.slug.startsWith('glean-context-'));
  const archive = reports.filter((r) => r.slug !== latestWeeklySlug);

  return (
    <div className="leadership-export-root space-y-6 print:space-y-0">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Expand 3 Executive Dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Weekly CSE management brief — renewal risk, churn & downsell exposure, save-motion
            execution, and customer engagement across the Expand 3 book. Download PDF for staff
            meetings (landscape, 3 pages).
          </p>
        </div>
        {latestMd && (
          <div className="flex items-center gap-2">
            <LeadershipPrintButton />
            <LeadershipPdfButton
              markdown={latestMd}
              filename={latestWeeklySlug ?? undefined}
            />
          </div>
        )}
      </div>

      {!latestMd ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
          No weekly executive brief found yet.
        </div>
      ) : (
        <LeadershipDashboard markdown={latestMd} slug={latestWeeklySlug!} />
      )}

      {supplements.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 print:hidden">
          <h2 className="text-sm font-semibold text-gray-700">Supporting evidence (Glean)</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {supplements.map((r) => (
              <li key={r.slug}>
                <Link href={`/admin/leadership/${r.slug}`} className="text-blue-700 underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {archive.length > 0 && (
        <section className="print:hidden">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Prior weekly briefs</h2>
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {reports.map((r) => (
              <li key={r.slug} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium capitalize">{r.title}</p>
                  <p className="text-xs text-gray-500">{r.slug}.md</p>
                </div>
                <Link href={`/admin/leadership/${r.slug}`} className="text-sm text-blue-700 underline">
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
