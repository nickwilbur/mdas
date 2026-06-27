import { CseActivityConfigEditor } from '@/components/CseActivityConfigEditor';
import Link from 'next/link';
import { loadCseActivityConfig } from '@/lib/cse-activity/config';
import { getInferredTeamFromViews } from '@/lib/cse-activity/service';

export const dynamic = 'force-dynamic';

export default async function CseActivityConfigPage() {
  const config = loadCseActivityConfig();
  const inferredTeam = await getInferredTeamFromViews();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/cse-activity" className="text-sm text-blue-700 underline">
          ← CSE Activity
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">CSE Activity Configuration</h1>
        <p className="text-sm text-gray-600">
          Slack channels, timezone, snapshot paths, and optional account overrides. The CSE roster is
          inferred automatically from Expand 3 account assignments in MDAS.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-500">Inferred team roster</h2>
        <p className="mt-1 text-xs text-gray-500">
          {inferredTeam.length} CSE{inferredTeam.length === 1 ? '' : 's'} from current Expand 3
          book — read-only, refreshed on each snapshot.
        </p>
        {inferredTeam.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No assigned CSEs found on Expand 3 accounts.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {inferredTeam.map((member) => (
              <li key={member.mdasCseId ?? member.name} className="flex justify-between py-2">
                <span className="font-medium">{member.name}</span>
                <span className="text-gray-500">{member.email}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CseActivityConfigEditor initial={config} />
    </div>
  );
}
