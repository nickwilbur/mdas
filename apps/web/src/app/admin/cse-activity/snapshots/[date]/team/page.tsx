import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listTeamMemberSlugs } from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default async function CseSnapshotTeamIndexPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const members = listTeamMemberSlugs(date);
  if (members.length === 0) notFound();

  return (
    <div className="space-y-4">
      <Link href={`/admin/cse-activity/snapshots/${date}`} className="text-sm text-blue-700 underline">
        ← Manager dashboard
      </Link>
      <h1 className="text-2xl font-semibold">Team member reports — {date}</h1>
      <p className="text-sm text-gray-600">
        Coaching-oriented weekly reflections generated from the same immutable snapshot. Send or edit
        before sharing with each CSE.
      </p>
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        {members.map((m) => (
          <li key={m.slug} className="px-4 py-3">
            <Link
              href={`/admin/cse-activity/snapshots/${date}/members/${m.slug}`}
              className="font-medium text-blue-700 underline"
            >
              {m.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
