import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  LeadershipPdfButton,
  LeadershipPrintButton,
} from '@/components/leadership/LeadershipPdfButton';
import { LeadershipDashboard } from '@/components/LeadershipDashboard';
import { readLeadershipReport } from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default async function LeadershipReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const md = readLeadershipReport(slug);
  if (!md) notFound();

  return (
    <div className="leadership-export-root space-y-4 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/admin/leadership" className="text-sm text-blue-700 underline">
            ← Expand 3 executive dashboard
          </Link>
          <h1 className="mt-1 text-xl font-semibold capitalize">{slug.replace(/-/g, ' ')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <LeadershipPrintButton />
          <LeadershipPdfButton markdown={md} filename={slug} />
        </div>
      </div>

      <LeadershipDashboard markdown={md} slug={slug} />
    </div>
  );
}
