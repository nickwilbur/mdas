import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarkdownDocument } from '@/components/MarkdownDocument';
import { PrintReportButton } from '@/components/CseActivityHub';
import { getTeamMemberReportMarkdown, listTeamMemberSlugs } from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default async function CseTeamMemberReportPage({
  params,
}: {
  params: Promise<{ date: string; slug: string }>;
}) {
  const { date, slug } = await params;
  const md = getTeamMemberReportMarkdown(date, slug);
  if (!md) notFound();
  const members = listTeamMemberSlugs(date);
  const name = members.find((m) => m.slug === slug)?.name ?? slug;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link
            href={`/admin/cse-activity/snapshots/${date}/team`}
            className="text-sm text-blue-700 underline"
          >
            ← Team reports
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            {name} — weekly reflection ({date})
          </h1>
        </div>
        <PrintReportButton />
      </div>
      <MarkdownDocument markdown={md} />
    </div>
  );
}
