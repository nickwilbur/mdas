import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarkdownDocument } from '@/components/MarkdownDocument';
import { PrintReportButton } from '@/components/CseActivityHub';
import { getManagerDashboardMarkdown, listTeamMemberSlugs } from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default async function CseSnapshotDashboardPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const md = getManagerDashboardMarkdown(date);
  if (!md) notFound();
  const members = listTeamMemberSlugs(date);

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/admin/cse-activity" className="text-sm text-blue-700 underline">
            ← CSE Activity
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Manager dashboard — {date}</h1>
        </div>
        <div className="flex gap-2">
          <PrintReportButton />
          <Link
            href={`/admin/cse-activity/snapshots/${date}/team`}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Team member reports
          </Link>
        </div>
      </div>
      <MarkdownDocument markdown={md} />
      {members.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 print:hidden">
          <h2 className="text-sm font-semibold">Individual reports from this snapshot</h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {members.map((m) => (
              <li key={m.slug}>
                <Link
                  href={`/admin/cse-activity/snapshots/${date}/members/${m.slug}`}
                  className="text-blue-700 underline"
                >
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
