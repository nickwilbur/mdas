import { CTABoard, GenerateCTAsButton } from '@/components/CTABoard';
import { getDashboardData } from '@/lib/read-model';
import { buildAccountHoverContextMap } from '@/lib/cta-account-context';
import { loadCTAData } from '@/lib/cta-data';

export const dynamic = 'force-dynamic';

export default async function CTAsPage({
  searchParams,
}: {
  searchParams: Promise<{ cta?: string }>;
}) {
  const { cta: focusCtaId } = await searchParams;
  const { ctas, slackMessages } = loadCTAData();
  const { views } = await getDashboardData();
  const accountContexts = buildAccountHoverContextMap(views);

  if (ctas.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-semibold">Churn-Risk CTAs</h1>
          <GenerateCTAsButton />
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <div className="mx-auto max-w-md space-y-3">
            <p className="text-4xl">📋</p>
            <p className="text-sm font-medium text-gray-900">No CTAs generated yet</p>
            <p className="text-xs text-gray-500">
              Click <strong>Generate CTAs</strong> above or run{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                /expand3-cta-generator scan
              </code>{' '}
              in Cascade to scan all 224 Expand 3 accounts.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Churn-Risk CTAs</h1>
          <p className="text-xs text-gray-500">
            Expand 3 — generated from Cerebro, SFDC, and Glean signals
          </p>
        </div>
        <GenerateCTAsButton />
      </div>
      <CTABoard
        ctas={ctas}
        slackMessages={slackMessages}
        accountContexts={accountContexts}
        focusCtaId={focusCtaId ?? null}
      />
    </div>
  );
}
