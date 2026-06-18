import type { AccountView } from '@mdas/canonical';
import type { CTAEngineConfig } from './config.js';
import { daysSinceLastActivity, hasRecentActivity, isWithinDays } from './activity.js';
import type { DarkAccountAssessment, DarkSignal } from './types.js';

const DAY = 86_400_000;

function execMeetingCount(account: AccountView['account']): number | null {
  const fromSub =
    account.cerebroSubMetrics?.['crExecutiveMeetingCount'] ??
    account.cerebroSubMetrics?.['Executive Meeting Count (90d)'];
  if (typeof fromSub === 'number') return fromSub;
  return null;
}

function pbuPercent(account: AccountView['account']): number | null {
  const raw =
    account.cerebroSubMetrics?.['Projected Billing Utilization (%)'] ??
    account.cerebroSubMetrics?.['crProjectedBillingUtilization'];
  return typeof raw === 'number' ? raw : null;
}

/**
 * Weighted dark-account detector grounded in canonical snapshot fields.
 * Fires when weighted score >= config.darkAccountMinWeight.
 */
export function assessDarkAccount(
  view: AccountView,
  config: CTAEngineConfig,
  now: number = Date.now(),
): DarkAccountAssessment {
  const { account } = view;
  const lookback = config.darkAccountLookbackDays;
  const signals: DarkSignal[] = [];

  const commentaryUpdated = account.cseSentimentCommentaryLastUpdated;
  if (
    !commentaryUpdated ||
    !isWithinDays(commentaryUpdated, lookback, now)
  ) {
    const days = commentaryUpdated
      ? Math.floor((now - Date.parse(commentaryUpdated)) / DAY)
      : undefined;
    signals.push({
      id: 'stale_commentary',
      label: commentaryUpdated
        ? `CSE sentiment commentary last updated ${days}d ago`
        : 'No CSE sentiment commentary on record',
      weight: 1,
      source: 'salesforce',
      observedAt: commentaryUpdated ?? undefined,
      daysAgo: days,
    });
  }

  if (!account.assignedCSE || account.csCoverage === 'Digital') {
    signals.push({
      id: 'no_cse',
      label: 'No dedicated CSE (digital coverage)',
      weight: 1,
      source: 'salesforce',
    });
  }

  if (!account.salesforceSlackChannelUrl) {
    signals.push({
      id: 'no_slack',
      label: 'No Slack channel in SFDC',
      weight: 1,
      source: 'salesforce',
    });
  }

  if (!hasRecentActivity(account, lookback, now)) {
    const days = daysSinceLastActivity(account, now);
    signals.push({
      id: 'no_recent_activity',
      label: days == null
        ? 'No recorded meetings, workshops, or commentary updates'
        : `No customer-facing activity in ${lookback}d (last signal ${days}d ago)`,
      weight: 1,
      source: 'glean-mcp',
      daysAgo: days ?? undefined,
    });
  }

  const hasWorkshop365 = account.workshops.some((w) => {
    if (!w.workshopDate) return false;
    const t = Date.parse(w.workshopDate);
    return Number.isFinite(t) && now - t <= 365 * DAY;
  });
  if (!hasWorkshop365) {
    signals.push({
      id: 'no_workshop',
      label: 'No workshop logged in the last 365 days',
      weight: 0.5,
      source: 'salesforce',
    });
  }

  if (account.cerebroRisks?.engagementRisk === true) {
    signals.push({
      id: 'cerebro_engagement_risk',
      label: 'Cerebro engagement risk flagged',
      weight: 1,
      source: 'cerebro',
    });
  }

  const eng30 = account.engagementMinutes30d;
  if (eng30 == null || eng30 < config.lowEngagementMinutes30d) {
    signals.push({
      id: 'low_engagio',
      label:
        eng30 == null
          ? 'Engagio engagement minutes unavailable'
          : `Engagio engagement ${eng30} min (30d) — below threshold`,
      weight: 0.5,
      source: 'salesforce',
    });
  }

  const weightedScore = signals.reduce((s, sig) => s + sig.weight, 0);
  const independentSources = new Set(signals.map((s) => s.source)).size;

  let confidence: DarkAccountAssessment['confidence'];
  if (independentSources >= 3) confidence = 'high';
  else if (independentSources >= 2) confidence = 'medium';
  else confidence = 'low';

  // Structural-only (no CSE + no Slack) without activity data → lower confidence
  const structuralOnly =
    signals.every((s) => s.id === 'no_cse' || s.id === 'no_slack') &&
    signals.length <= 2;
  if (structuralOnly) confidence = 'low';

  return {
    isDark: weightedScore >= config.darkAccountMinWeight,
    weightedScore,
    signals,
    confidence,
    daysSinceLastActivity: daysSinceLastActivity(account, now),
  };
}

/** Re-export simple dark list for forecast compatibility (7-day window). */
export interface SimpleDarkAccount {
  accountId: string;
  accountName: string;
  daysSinceLastSignal: number;
  reason: string;
  arr: number;
}

export function findSimpleDarkAccounts(
  views: AccountView[],
  options: { windowDays?: number; now?: number } = {},
): SimpleDarkAccount[] {
  const { windowDays = 7, now = Date.now() } = options;
  const out: SimpleDarkAccount[] = [];
  for (const v of views) {
    if (v.bucket === 'Confirmed Churn') continue;
    const days = daysSinceLastActivity(v.account, now);
    if (days != null && days < windowDays) continue;
    if (days == null && hasRecentActivity(v.account, windowDays, now)) continue;

    const reason =
      days == null ? 'no recorded customer signal' : `${days}d since last signal`;
    out.push({
      accountId: v.account.accountId,
      accountName: v.account.accountName,
      daysSinceLastSignal: days ?? -1,
      reason,
      arr: v.account.allTimeARR ?? 0,
    });
  }
  out.sort((a, b) => b.arr - a.arr);
  return out;
}

export { execMeetingCount, pbuPercent };
