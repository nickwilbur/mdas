import type { AccountView } from '@mdas/canonical';
import type { CTAEngineConfig } from './config.js';
import { hasRecentActivity } from './activity.js';

const DAY = 86_400_000;

const PLAY_THEME: Record<string, RegExp> = {
  utilization_risk: /utilization|usage|billing/i,
  engagement_risk: /engagement|exec|meeting/i,
  dark_account: /dark|visibility|re-engage/i,
  dark_renewal: /renewal|dark/i,
  no_strategic_engagement: /strategic|exec|VP/i,
};

export interface SuppressResult {
  suppressed: boolean;
  reason?: string;
}

/**
 * Anti-signals from workflow spec — reasons NOT to post even if a rule fired.
 */
export function shouldSuppress(
  view: AccountView,
  playType: string,
  config: CTAEngineConfig,
  now: number = Date.now(),
): SuppressResult {
  const { account } = view;

  // Recent owner activity in indexed meetings (7d)
  if (hasRecentActivity(account, 7, now)) {
    const commentary = account.cseSentimentCommentary ?? '';
    if (/\b(migration|RFP|paused|pause\s+vendor|Q3)\b/i.test(commentary)) {
      return {
        suppressed: true,
        reason: 'Customer mid-migration/RFP — paused vendor activity per commentary',
      };
    }
  }

  // Open Gainsight CTA covering same play theme
  const theme = PLAY_THEME[playType];
  if (theme) {
    const openGs = account.gainsightTasks.filter(
      (t) => !/closed|complete|done|invalid/i.test(t.status),
    );
    for (const t of openGs) {
      if (theme.test(t.title)) {
        return {
          suppressed: true,
          reason: `Open Gainsight CTA covers this play: "${t.title}"`,
        };
      }
    }
  }

  // Confirmed churn should not get re-engagement plays
  if (
    view.bucket === 'Confirmed Churn' &&
    playType !== 'confirmed_churn_retro' &&
    playType !== 'churn_retro'
  ) {
    return { suppressed: true, reason: 'Confirmed churn — retro only' };
  }

  // Team-aware active plan suppresses risk CTAs except data_quality
  const commentary = account.cseSentimentCommentary ?? '';
  if (
    /\b(action\s+plan|on\s+track|actively\s+working)\b/i.test(commentary) &&
    !['data_quality_gap', 'managed_wind_down', 'confirmed_churn_retro'].includes(playType)
  ) {
    return {
      suppressed: true,
      reason: 'Commentary documents active plan — team aware',
    };
  }

  return { suppressed: false };
}

export function dedupKey(
  salesforceAccountId: string | null,
  playType: string,
  renewalOpportunityId?: string | null,
): string {
  if (renewalOpportunityId) {
    return `${renewalOpportunityId}:${playType}`;
  }
  return `${salesforceAccountId ?? 'unknown'}:${playType}`;
}

export function isWithinDedupWindow(
  postedAt: string,
  windowDays: number,
  now: number = Date.now(),
): boolean {
  const t = Date.parse(postedAt);
  if (Number.isNaN(t)) return false;
  return now - t <= windowDays * DAY;
}
