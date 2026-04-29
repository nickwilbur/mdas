// ActionQueue — top accounts ranked by composite priority for the
// "first 10 seconds" landing pane on /. Each row answers:
//   "What changed on this account, and what should I do next?"
//
// Audit ref: F-04, F-05 in docs/audit/01_findings.md.
//
// Server component — receives pre-computed data from the dashboard page
// so we don't re-query Postgres here.
import Link from 'next/link';
import { computeRiskScore } from '@mdas/scoring';
import type { AccountView, ChangeEvent } from '@mdas/canonical';
import { BucketBadge, RiskBadge, fmtUSD } from '@/components/ui';

interface ActionQueueProps {
  views: AccountView[];
  events: ChangeEvent[];
  /** How many top rows to show. Default 5. */
  limit?: number;
}

interface RankedRow {
  view: AccountView;
  score: number;
  reason: string;
  movement: string | null;
}

const RISK_RANK: Record<string, number> = {
  Critical: 100,
  High: 70,
  Medium: 40,
  Low: 10,
  Unknown: 0,
};

function describeMovement(events: ChangeEvent[]): string | null {
  if (events.length === 0) return null;
  // Prioritize churn-notice → risk → sentiment → forecast → other.
  const order: ChangeEvent['category'][] = [
    'churn-notice',
    'risk',
    'sentiment',
    'forecast',
    'hygiene',
    'workshop',
  ];
  const sorted = [...events].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category),
  );
  const first = sorted[0];
  if (!first) return null;
  const more = events.length - 1;
  return more > 0 ? `${first.label} (+${more} more)` : first.label;
}

function nextStepFor(view: AccountView): string {
  // Surface the most actionable next-step text from the data we have.
  const opp = view.opportunities.find((o) => (o.scNextSteps ?? '').trim().length > 0);
  if (opp?.scNextSteps) {
    const text = opp.scNextSteps.trim();
    return text.length > 80 ? `${text.slice(0, 78)}…` : text;
  }
  // Fall back to the highest-confidence hygiene coaching prompt.
  const high = view.hygiene.violations.find((v) => v.confidence === 'high');
  if (high) return high.coachingPrompt;
  if (view.bucket === 'Confirmed Churn') {
    return view.account.churnReasonSummary
      ? `Churn confirmed — ${view.account.churnReasonSummary}`
      : 'Churn confirmed — capture reason and ensure ATR is logged.';
  }
  return 'Open the drill-in to capture the plan.';
}

function rankView(
  view: AccountView,
  events: ChangeEvent[],
): RankedRow {
  const accountEvents = events.filter((e) => e.accountId === view.account.accountId);
  const risk = computeRiskScore({
    account: view.account,
    opportunities: view.opportunities,
    changeEvents: accountEvents,
  });
  // Composite: risk score (0–100) + bucket weight + days-to-renewal
  // urgency + ARR exposure normalized against the largest in the set.
  const bucketWeight =
    view.bucket === 'Confirmed Churn'
      ? 80
      : view.bucket === 'Saveable Risk'
        ? 50
        : 0;
  const renewalUrgency =
    view.daysToRenewal == null
      ? 0
      : view.daysToRenewal <= 30
        ? 30
        : view.daysToRenewal <= 60
          ? 18
          : view.daysToRenewal <= 90
            ? 8
            : 0;
  const movementBoost = accountEvents.length > 0 ? 10 : 0;
  const score = risk.score + bucketWeight + renewalUrgency + movementBoost;
  const reasonParts: string[] = [];
  if (risk.confidence === 'high') {
    reasonParts.push(`Risk ${risk.score}`);
  } else {
    reasonParts.push(`Risk ${risk.score} (low conf)`);
  }
  if (view.daysToRenewal != null && view.daysToRenewal <= 90) {
    reasonParts.push(`renews in ${view.daysToRenewal}d`);
  }
  if (view.atrUSD > 0) {
    reasonParts.push(`ATR ${fmtUSD(view.atrUSD)}`);
  }
  return {
    view,
    score,
    reason: reasonParts.join(' · '),
    movement: describeMovement(accountEvents),
  };
}

export function ActionQueue({ views, events, limit = 5 }: ActionQueueProps): JSX.Element {
  const ranked = views
    .map((v) => rankView(v, events))
    // Drop healthy with no movement — they don't need attention this morning.
    .filter((r) => {
      if (r.view.bucket !== 'Healthy') return true;
      return r.movement !== null;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (ranked.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        No actions queued. Nothing in your book is at risk or has moved this
        week.
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {ranked.map((r, i) => (
        <li
          key={r.view.account.accountId}
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
            {i + 1}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/accounts/${r.view.account.accountId}`}
                className="font-medium hover:underline"
              >
                {r.view.account.accountName}
              </Link>
              <BucketBadge bucket={r.view.bucket} />
              <RiskBadge level={r.view.risk.level} source={r.view.risk.source} />
              <span className="text-xs text-gray-500">{r.reason}</span>
            </div>
            {r.movement ? (
              <div className="mt-1 text-xs text-amber-800">⚡ {r.movement}</div>
            ) : null}
            <div className="mt-1 text-sm text-gray-800">→ {nextStepFor(r.view)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
