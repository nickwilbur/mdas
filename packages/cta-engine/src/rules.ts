import type { AccountView, CanonicalOpportunity } from '@mdas/canonical';
import { isConfirmedChurn } from '@mdas/canonical';
import type { CTAEngineConfig } from './config.js';
import { assessDarkAccount, pbuPercent } from './dark-account.js';
import { hasRecentActivity, isWithinDays } from './activity.js';
import { nextFutureRenewalOpp } from './scope.js';
import type { CTAPlayType } from './types.js';

const DAY = 86_400_000;

const WIND_DOWN_PATTERN =
  /\b(wind[\s-]?down|shut(?:ting)?\s+down|exit(?:ing)?|consolidat(?:e|ing)|moving\s+off|decommission|EOL|end\s+of\s+life)\b/i;

const ACTIVE_PLAN_PATTERN =
  /\b(action\s+plan|on\s+track|actively\s+working|scheduled|in\s+progress|QBR|review\s+scheduled)\b/i;

export interface RuleContext {
  view: AccountView;
  config: CTAEngineConfig;
  now: number;
  scanDate: string;
}

export interface PlayCandidate {
  play_type: CTAPlayType;
  priority_score: number;
  drivers: string[];
  source_signals: Array<{ source: string; signal: string; observedAt?: string }>;
  data_gaps: string[];
  team_aware?: boolean;
  confidence: 'high' | 'medium' | 'low';
}

function renewalOpp(view: AccountView, now: number): CanonicalOpportunity | null {
  return nextFutureRenewalOpp(view, now);
}

function isRenewalStale(opp: CanonicalOpportunity, _config: CTAEngineConfig): boolean {
  const hasNextSteps = (opp.scNextSteps ?? '').trim().length > 0;
  if (!hasNextSteps) return true;
  // Proxy: early stage + no FLM notes suggests stale opp hygiene
  const earlyStage = (opp.stageNum ?? 0) <= 2;
  return earlyStage;
}

function hasDataQualityGap(view: AccountView): boolean {
  const { account } = view;
  const errors = account.sourceErrors ?? {};
  const missingCerebro = !account.lastFetchedFromSource?.cerebro && !account.cerebroRiskCategory;
  const missingGlean =
    !account.lastFetchedFromSource?.['glean-mcp'] && account.recentMeetings.length === 0;
  const hasErrors = Object.keys(errors).length > 0;
  return hasErrors || (missingCerebro && missingGlean);
}

function commentaryDocumentsWindDown(commentary: string | null): boolean {
  if (!commentary) return false;
  return WIND_DOWN_PATTERN.test(commentary);
}

function commentaryShowsActivePlan(commentary: string | null): boolean {
  if (!commentary) return false;
  return ACTIVE_PLAN_PATTERN.test(commentary);
}

function daysUntilRenewal(view: AccountView): number | null {
  return view.daysToRenewal;
}

function withinRenewalWindow(view: AccountView, quarters: number, now: number): boolean {
  const days = daysUntilRenewal(view);
  if (days == null || days < 0) return false;
  return days <= quarters * 91;
}

function cerebroRiskPlay(
  view: AccountView,
  field: keyof NonNullable<AccountView['account']['cerebroRisks']>,
  play_type: CTAPlayType,
  label: string,
): PlayCandidate | null {
  if (view.account.cerebroRisks?.[field] !== true) return null;
  return {
    play_type,
    priority_score: 45,
    drivers: [label],
    source_signals: [{ source: 'cerebro', signal: label }],
    data_gaps: [],
    confidence: 'high',
  };
}

/**
 * Evaluate all applicable play types; returns candidates sorted by priority desc.
 */
export function evaluatePlayCandidates(ctx: RuleContext): PlayCandidate[] {
  const { view, config, now } = ctx;
  const { account } = view;
  const candidates: PlayCandidate[] = [];

  if (view.bucket === 'Confirmed Churn' || isConfirmedChurn(account, view.opportunities)) {
    candidates.push({
      play_type: 'confirmed_churn_retro',
      priority_score: 30,
      drivers: ['Confirmed churn — retro only'],
      source_signals: [{ source: 'salesforce', signal: 'Confirmed churn' }],
      data_gaps: [],
      confidence: 'high',
    });
    return candidates;
  }

  const commentary = account.cseSentimentCommentary;
  const teamAware = commentaryShowsActivePlan(commentary);

  if (commentaryDocumentsWindDown(commentary)) {
    candidates.push({
      play_type: 'managed_wind_down',
      priority_score: 70,
      drivers: ['Commentary documents customer wind-down or exit'],
      source_signals: [{ source: 'salesforce', signal: 'Wind-down documented in commentary' }],
      data_gaps: [],
      confidence: 'high',
      team_aware: true,
    });
  }

  // Data quality — only for high-value accounts with insufficient signals
  if (hasDataQualityGap(view) && (account.allTimeARR ?? 0) >= 100_000) {
    const gaps: string[] = [];
    if (account.sourceErrors?.cerebro) gaps.push(`Cerebro: ${account.sourceErrors.cerebro}`);
    if (account.sourceErrors?.['glean-mcp']) gaps.push(`Glean: ${account.sourceErrors['glean-mcp']}`);
    if (!account.cerebroRiskCategory && !account.lastFetchedFromSource?.cerebro) {
      gaps.push('No Cerebro health data');
    }
    if (account.recentMeetings.length === 0 && !account.lastFetchedFromSource?.['glean-mcp']) {
      gaps.push('No indexed Glean activity');
    }
    candidates.push({
      play_type: 'data_quality_gap',
      priority_score: 25,
      drivers: gaps.length ? gaps : ['Key engagement signals missing or stale'],
      source_signals: gaps.map((g) => ({ source: 'derived', signal: g })),
      data_gaps: gaps,
      confidence: 'low',
    });
  }

  const dark = assessDarkAccount(view, config, now);
  const renewalInWindow = withinRenewalWindow(view, config.renewalWindowQuarters, now);
  const opp = renewalOpp(view, now);

  if (dark.isDark) {
    const darkDrivers = dark.signals.map((s) => s.label);
    let score = 55 + dark.weightedScore * 8;
    if ((account.allTimeARR ?? 0) >= 500_000) score += 15;
    const days = daysUntilRenewal(view);
    if (days != null && days <= 90) score += 12;
    if (days != null && days <= 30) score += 10;

    candidates.push({
      play_type: 'dark_account',
      priority_score: score,
      drivers: darkDrivers,
      source_signals: dark.signals.map((s) => ({
        source: s.source,
        signal: s.label,
        observedAt: s.observedAt,
      })),
      data_gaps: [],
      confidence: dark.confidence,
      team_aware: teamAware,
    });
  }

  if (
    renewalInWindow &&
    opp &&
    (isRenewalStale(opp, config) || !hasRecentActivity(account, config.darkRenewalOppStaleDays, now))
  ) {
    const days = daysUntilRenewal(view);
    let score = 50;
    if (days != null && days <= 90) score += 15;
    if (!account.salesforceSlackChannelUrl) score += 8;
    candidates.push({
      play_type: 'dark_renewal',
      priority_score: score,
      drivers: [
        `Renewal date: ${opp.closeDate}`,
        !hasRecentActivity(account, config.darkRenewalOppStaleDays, now)
          ? `No customer activity in ${config.darkRenewalOppStaleDays}d`
          : 'Renewal opp lacks recent next steps',
      ],
      source_signals: [
        { source: 'salesforce', signal: `Renewal opp stage: ${opp.stageName}` },
      ],
      data_gaps: !account.salesforceSlackChannelUrl ? ['No Slack channel confirmed'] : [],
      confidence: dark.confidence,
    });
  }

  const pbu = pbuPercent(account);
  if (
    (account.cerebroRisks?.utilizationRisk === true ||
      (pbu != null && pbu < config.utilizationThresholdPct)) &&
    !commentaryDocumentsWindDown(commentary)
  ) {
    candidates.push({
      play_type: 'utilization_risk',
      priority_score: 60,
      drivers: [
        pbu != null
          ? `Projected billing utilization: ${pbu}%`
          : 'Cerebro utilization risk flagged',
      ],
      source_signals: [{ source: 'cerebro', signal: 'Utilization risk' }],
      data_gaps: [],
      confidence: pbu != null ? 'high' : 'medium',
    });
  }

  const engPlay = cerebroRiskPlay(view, 'engagementRisk', 'engagement_risk', 'Cerebro engagement risk flagged');
  if (engPlay) candidates.push(engPlay);

  for (const [field, play, label] of [
    ['suiteRisk', 'suite_risk', 'Cerebro suite risk flagged'],
    ['shareRisk', 'share_risk', 'Cerebro share risk flagged'],
    ['legacyTechRisk', 'legacy_tech_risk', 'Cerebro legacy tech risk flagged'],
    ['pricingRisk', 'pricing_risk', 'Cerebro pricing risk flagged'],
    ['expertiseRisk', 'expertise_risk', 'Cerebro expertise risk flagged'],
  ] as const) {
    const p = cerebroRiskPlay(view, field, play, label);
    if (p) candidates.push(p);
  }

  const execCount =
    account.cerebroSubMetrics?.['crExecutiveMeetingCount'] ??
    account.cerebroSubMetrics?.['Executive Meeting Count (90d)'];
  const renewal2Q = daysUntilRenewal(view);
  if (
    typeof execCount === 'number' &&
    execCount === 0 &&
    renewal2Q != null &&
    renewal2Q <= 180
  ) {
    candidates.push({
      play_type: 'no_strategic_engagement',
      priority_score: 48,
      drivers: ['No VP+ meetings in 90 days', `Renewal in ${renewal2Q}d`],
      source_signals: [{ source: 'cerebro', signal: 'Executive meeting count: 0' }],
      data_gaps: [],
      confidence: 'high',
    });
  }

  const commentaryAge = account.cseSentimentCommentaryLastUpdated;
  const commentaryStale =
    !commentaryAge || !isWithinDays(commentaryAge, config.sentimentStaleDays, now);
  if (
    commentaryStale &&
    renewal2Q != null &&
    renewal2Q <= 180 &&
    account.cseSentiment !== 'Green'
  ) {
    candidates.push({
      play_type: 'sentiment_stale',
      priority_score: 42,
      drivers: [
        commentaryAge
          ? `Sentiment commentary last updated ${Math.floor((now - Date.parse(commentaryAge)) / DAY)}d ago`
          : 'No sentiment commentary on record',
        `Renewal in ${renewal2Q}d`,
      ],
      source_signals: [{ source: 'salesforce', signal: 'Stale sentiment commentary' }],
      data_gaps: [],
      confidence: 'high',
    });
  }

  if (
    account.cseSentiment === 'Yellow' &&
    renewal2Q != null &&
    renewal2Q <= 180 &&
    !teamAware
  ) {
    candidates.push({
      play_type: 'surprise_churn_watch',
      priority_score: 52,
      drivers: ['CSE Sentiment: Yellow', `Renewal in ${renewal2Q}d`],
      source_signals: [{ source: 'salesforce', signal: 'Yellow sentiment + renewal proximity' }],
      data_gaps: [],
      confidence: 'medium',
    });
  }

  // Integrate composite risk score boost
  if (view.riskScore) {
    const boost = Math.round(view.riskScore.score * 0.15);
    for (const c of candidates) {
      c.priority_score += boost;
    }
  }

  candidates.sort((a, b) => b.priority_score - a.priority_score);
  return candidates;
}

export function pickBestPlay(candidates: PlayCandidate[]): PlayCandidate | null {
  if (candidates.length === 0) return null;
  return candidates[0]!;
}
