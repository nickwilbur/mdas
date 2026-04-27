import Link from 'next/link';
import { getDashboardData } from '@/lib/read-model';
import { BucketBadge, RiskBadge, SentimentBadge, fmtUSD } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const { views } = await getDashboardData();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Accounts — Manager Priority</h1>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">CSE</th>
              <th className="px-3 py-2">Bucket</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Sentiment</th>
              <th className="px-3 py-2 text-right">ATR</th>
              <th className="px-3 py-2 text-right">ACV Δ</th>
              <th className="px-3 py-2">Renewal</th>
              <th className="px-3 py-2 text-center">Hygiene</th>
              <th className="px-3 py-2">Last Sentiment Update</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => {
              const acvDelta = v.opportunities.reduce((s, o) => s + (o.acvDelta ?? 0), 0);
              return (
                <tr key={v.account.accountId} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{v.priorityRank}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/accounts/${v.account.accountId}`} className="hover:underline">
                      {v.account.accountName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{v.account.assignedCSE?.name ?? '—'}</td>
                  <td className="px-3 py-2"><BucketBadge bucket={v.bucket} /></td>
                  <td className="px-3 py-2"><RiskBadge level={v.risk.level} source={v.risk.source} /></td>
                  <td className="px-3 py-2"><SentimentBadge value={v.account.cseSentiment} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtUSD(v.atrUSD)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${acvDelta < 0 ? 'text-red-700' : acvDelta > 0 ? 'text-green-700' : 'text-gray-600'}`}>
                    {fmtUSD(acvDelta)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {v.daysToRenewal == null ? '—' : `${v.daysToRenewal}d`}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {v.hygiene.score === 0 ? (
                      <span className="text-gray-400">0</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        {v.hygiene.score}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {v.account.cseSentimentCommentaryLastUpdated
                      ? new Date(v.account.cseSentimentCommentaryLastUpdated).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Sorted by Manager Priority. Default rank uses bucket → Risk Category → days to renewal → ATR.</p>
    </div>
  );
}
