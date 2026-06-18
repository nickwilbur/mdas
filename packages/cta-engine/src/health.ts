import type { AccountView } from '@mdas/canonical';
import type { CTAEngineConfig } from './config.js';
import { hasRecentActivity, isWithinDays } from './activity.js';
import { assessDarkAccount, pbuPercent } from './dark-account.js';
import type { CTAPlayType } from './types.js';

const WIND_DOWN_PATTERN =
  /\b(wind[\s-]?down|shut(?:ting)?\s+down|exit(?:ing)?|consolidat(?:e|ing)|moving\s+off|decommission|EOL|end\s+of\s+life)\b/i;

/** Plays that represent dark, renewal, or identified risk — eligible even when sentiment is Green. */
const RISK_OR_DARK_PLAYS: ReadonlySet<CTAPlayType> = new Set([
  'dark_account',
  'dark_renewal',
  'utilization_risk',
  'engagement_risk',
  'no_strategic_engagement',
  'surprise_churn_watch',
  'sentiment_stale',
  'managed_wind_down',
  'suite_risk',
  'share_risk',
  'legacy_tech_risk',
  'pricing_risk',
  'expertise_risk',
  'churn_retro',
  'confirmed_churn_retro',
]);

export function isRiskOrDarkPlay(playType: string): boolean {
  return RISK_OR_DARK_PLAYS.has(playType as CTAPlayType);
}

export interface HealthAssessment {
  needsAttention: boolean;
  reasons: string[];
}

/**
 * True when the account is dark, carries identified Cerebro/SFDC risk,
 * or is otherwise unhealthy — eligible for a CTA (subject to anti-signals).
 *
 * Green sentiment does NOT imply healthy; darkness and risk signals are
 * evaluated independently of sentiment color.
 */
export function accountNeedsCtaAttention(
  view: AccountView,
  config: CTAEngineConfig,
  now: number = Date.now(),
): HealthAssessment {
  const { account } = view;
  const reasons: string[] = [];

  if (view.bucket === 'Saveable Risk') {
    reasons.push('Saveable risk bucket');
  }

  if (account.cseSentiment === 'Red' || account.cseSentiment === 'Yellow') {
    reasons.push(`CSE sentiment ${account.cseSentiment}`);
  }

  if (account.cerebroRiskCategory === 'High' || account.cerebroRiskCategory === 'Critical') {
    reasons.push(`Cerebro risk ${account.cerebroRiskCategory}`);
  }

  const risks = account.cerebroRisks ?? {};
  for (const [field, flagged] of Object.entries(risks)) {
    if (flagged === true) {
      reasons.push(`Cerebro ${field}`);
    }
  }

  const dark = assessDarkAccount(view, config, now);
  if (dark.isDark) {
    reasons.push('Dark account signals');
  } else if (dark.signals.length > 0) {
    reasons.push('Dark risk signals present');
  }

  const pbu = pbuPercent(account);
  if (pbu != null && pbu < config.utilizationThresholdPct) {
    reasons.push(`Low utilization (${pbu}%)`);
  }

  const engMins = account.engagementMinutes30d;
  if (engMins != null && engMins < config.lowEngagementMinutes30d) {
    reasons.push(`Low Engagio engagement (${engMins} min in 30d)`);
  }

  const commentaryUpdated = account.cseSentimentCommentaryLastUpdated;
  if (
    !commentaryUpdated ||
    !isWithinDays(commentaryUpdated, config.sentimentStaleDays, now)
  ) {
    reasons.push('Stale or missing sentiment commentary');
  }

  const days = view.daysToRenewal;
  if (
    days != null &&
    days >= 0 &&
    days <= config.renewalWindowQuarters * 91 &&
    !hasRecentActivity(account, config.darkRenewalOppStaleDays, now)
  ) {
    reasons.push(`No customer activity in ${config.darkRenewalOppStaleDays}d`);
  }

  if (WIND_DOWN_PATTERN.test(account.cseSentimentCommentary ?? '')) {
    reasons.push('Wind-down documented in commentary');
  }

  return { needsAttention: reasons.length > 0, reasons };
}
