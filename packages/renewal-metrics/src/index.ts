import type { AccountView, CanonicalOpportunity } from '@mdas/canonical';
import { isOperationalFullChurnOpportunity, CONFIRMED_FULL_CHURN_RISK } from '@mdas/canonical';
import {
  daysSinceLastCustomerEngagement,
  daysSinceLastSlackChannelUpdate,
  lastHumanCustomerEngagement,
  lastHumanSlackPost,
  type LastTouchDetail,
} from './engagement.js';

export type { LastTouchDetail } from './engagement.js';
export {
  daysSinceLastCustomerEngagement,
  daysSinceLastSlackChannelUpdate,
  lastHumanCustomerEngagement,
  lastHumanSlackPost,
} from './engagement.js';

/** Hover detail for Slack / engagement day counters. */
export interface EngagementLastTouch {
  title: string | null;
  summary: string | null;
  url: string | null;
  occurredAt: string | null;
}

function toEngagementLastTouch(detail: LastTouchDetail | null): EngagementLastTouch | null {
  if (!detail) return null;
  return {
    title: detail.title,
    summary: detail.summary,
    url: detail.url,
    occurredAt: detail.occurredAt,
  };
}
import { asOfDateForQuarter, enumerateFiscalQuarterKeys } from './fiscal.js';

const EPSILON = 0.01;

export {
  asOfDateForQuarter,
  enumerateFiscalQuarterKeys,
  fiscalQuarterEnd,
  isQuarterRetrospective,
  isRetrospectiveScope,
  parseFiscalQuarterKey,
} from './fiscal.js';

/**
 * Renewal performance metrics for the Expand 3 CSE Renewal Manager dashboard.
 *
 * Field semantics align with @mdas/forecast-generator:
 *   - ATR = `availableToRenewUSD` (per opp), rolled up at account level
 *   - Forecast ML / override are signed deltas on renewal (negative = loss)
 *   - `acvDelta` is the billing delta vs prior term on closed outcomes
 *
 * There is no dedicated `renewedRevenue` SFDC field — we derive it from
 * closed ACV / ACV delta and open manager forecast signals.
 */

export type RenewalOutcome =
  | 'full_churn'
  | 'downsell'
  | 'flat'
  | 'expanded'
  | 'pending'
  | 'pushed';

/** Closed renewal outcomes only — for quarter-close retrospective views. */
export function isClosedRenewalOutcome(outcome: RenewalOutcome): boolean {
  return outcome !== 'pending' && outcome !== 'pushed';
}

/** True when the renewal opportunity is still open in SFDC (not closed won/lost). */
export function isOpenRenewalOpportunity(opp: CanonicalOpportunity): boolean {
  return isRenewalLike(opp) && !isClosedOpportunity(opp);
}

export function isOpenRenewalOppRow(row: RenewalOppRow): boolean {
  return row.outcome === 'pending' || row.outcome === 'pushed';
}

/** Human label for prospective pipeline status (open renewals). */
export function prospectivePipelineStatus(
  outcome: RenewalOutcome,
  opts?: { atrUSD?: number; renewedRevenueUSD?: number },
): string {
  if (outcome === 'pushed') return 'Pushed / delayed';
  if (outcome === 'pending') {
    const atr = opts?.atrUSD ?? 0;
    const renewed = opts?.renewedRevenueUSD ?? 0;
    if (atr > 0 && renewed + EPSILON < atr) return 'Open · forecast downsell';
    if (atr > 0 && renewed > atr + EPSILON) return 'Open · forecast expansion';
    return 'Open';
  }
  return 'Closed';
}

export interface RenewalRiskSignalSummary {
  label: string;
  points: number;
  source: string;
}

export interface RenewalOppRow {
  opportunityId: string;
  opportunityName: string;
  accountId: string;
  accountName: string;
  cseName: string | null;
  accountOwner: string | null;
  cseSentiment: string | null;
  closeDate: string | null;
  stageName: string;
  renewalStatus: string;
  atrUSD: number;
  renewedRevenueUSD: number;
  churnedAtrUSD: number;
  downsellAmountUSD: number;
  downsellPct: number | null;
  /** Manager ML override or rep most-likely forecast (signed USD delta on ATR). */
  forecastMostLikelyUSD: number | null;
  outcome: RenewalOutcome;
  /** Cerebro / Glean Overall Assessment category (when available). */
  overallAssessment: string | null;
  /** Narrative detail for Overall Assessment hover. */
  overallAssessmentDetail: string | null;
  healthScore: number | null;
  healthBand: string | null;
  riskScoreConfidence: 'high' | 'low' | null;
  riskSignals: RenewalRiskSignalSummary[];
  usageIndicator: string | null;
  reason: string | null;
  nextStep: string | null;
  lastActivityDate: string | null;
  /** Days since last indexed Slack channel activity (null when no signal). */
  daysSinceSlackUpdate: number | null;
  /** Last human Slack post detail for hover. */
  slackLastTouch: EngagementLastTouch | null;
  /** Days since last customer-facing touch (meetings, workshops, CSE updates). */
  daysSinceCustomerEngagement: number | null;
  /** Last AE / CSE / leadership touch detail for hover. */
  customerEngagementLastTouch: EngagementLastTouch | null;
  salesforceUrl: string | null;
  opportunitySalesforceUrl: string;
}

export interface RenewalAccountRow {
  accountId: string;
  accountName: string;
  cseName: string | null;
  accountOwner: string | null;
  cseSentiment: string | null;
  renewalDate: string | null;
  renewalStatus: string;
  atrUSD: number;
  renewedRevenueUSD: number;
  churnedAtrUSD: number;
  downsellAmountUSD: number;
  downsellPct: number | null;
  outcome: RenewalOutcome;
  overallAssessment: string | null;
  overallAssessmentDetail: string | null;
  healthScore: number | null;
  healthBand: string | null;
  riskScoreConfidence: 'high' | 'low' | null;
  riskSignals: RenewalRiskSignalSummary[];
  usageIndicator: string | null;
  reason: string | null;
  nextStep: string | null;
  lastActivityDate: string | null;
  /** Days since last indexed Slack channel activity (null when no signal). */
  daysSinceSlackUpdate: number | null;
  slackLastTouch: EngagementLastTouch | null;
  /** Days since last customer-facing touch (meetings, workshops, CSE updates). */
  daysSinceCustomerEngagement: number | null;
  customerEngagementLastTouch: EngagementLastTouch | null;
  opportunityCount: number;
  salesforceUrl: string | null;
  opportunities: RenewalOppRow[];
}

export interface RenewalOutcomeCounts {
  flat: number;
  downsell: number;
  full_churn: number;
  expanded: number;
  pending: number;
  pushed: number;
}

export interface ReasonSummary {
  reason: string;
  accountCount: number;
  atrUSD: number;
}

/** Renewal opps with Churn Risk = Confirmed Full Churn — excluded from saveable renewal metrics. */
export interface KnownChurnSummary {
  accountCount: number;
  opportunityCount: number;
  /** Sum of availableToRenewUSD on known-churn renewal opps in scope. */
  atrUSD: number;
  /** Sum of Known_Churn_USD__c on those opps (informational; may be unset). */
  knownChurnUSD: number;
}

export interface KnownChurnOppRow {
  opportunityId: string;
  opportunityName: string;
  accountId: string;
  accountName: string;
  cseName: string | null;
  accountOwner: string | null;
  closeDate: string | null;
  stageName: string;
  churnRisk: string;
  atrUSD: number;
  knownChurnUSD: number;
  reason: string | null;
  salesforceUrl: string | null;
}

export interface RenewalMetricsSummary {
  /** Sum of ATR on renewal opps in scope. */
  atrUpForRenewalUSD: number;
  /** Sum of derived renewed revenue. */
  renewedRevenueUSD: number;
  /** Sum of ATR where outcome is full churn (mutually exclusive with downsell). */
  atrChurnedUSD: number;
  /** Sum of (ATR − renewed) on downsell accounts. */
  downsellAmountUSD: number;
  /** Accounts with full churn / accounts with ATR > 0 in scope. */
  fullLogoChurnRate: number | null;
  fullChurnAccountCount: number;
  /** Accounts with downsell / accounts with ATR > 0 in scope. */
  downsellAccountRate: number | null;
  downsellAccountCount: number;
  /** Gross revenue retention: renewed / ATR (expansion included in renewed). */
  grossRevenueRetentionPct: number | null;
  accountsUpForRenewal: number;
  outcomeCounts: RenewalOutcomeCounts;
  /** Closed outcomes only — for quarter-close retrospective charts. */
  retrospectiveOutcomeCounts: RenewalOutcomeCounts;
  /** Open renewals in scope (prospective pipeline). */
  openRenewalCount: number;
  openRenewalAtrUSD: number;
  pushedRenewalCount: number;
  bridge: {
    startingAtrUSD: number;
    fullChurnUSD: number;
    downsellUSD: number;
    expansionUSD: number;
    endingRenewedUSD: number;
  };
  topChurnReasonsByAtr: ReasonSummary[];
  topDownsellReasonsByAtr: ReasonSummary[];
  topChurnReasonsByCount: ReasonSummary[];
  /** Known churn (Churn Risk = Confirmed Full Churn) — tracked separately from saveable renewal metrics. */
  knownChurn: KnownChurnSummary;
  /** Prior-period snapshot when exactly one fiscal quarter is selected. */
  priorPeriod: Omit<
    RenewalMetricsSummary,
    | 'priorPeriod'
    | 'topChurnReasonsByAtr'
    | 'topDownsellReasonsByAtr'
    | 'topChurnReasonsByCount'
  > | null;
}

export interface BuildRenewalMetricsOpts {
  views: AccountView[];
  /** Fiscal quarter keys (e.g. `2027-Q1`). Null = all quarters. */
  quarterKeys: Set<string> | null;
  /** ISO date for pushed-renewal detection. Defaults to today. */
  asOfDate?: string;
  /** Optional prior-quarter keys for period-over-period KPI deltas. */
  priorQuarterKeys?: Set<string> | null;
}

/** True when SFDC Type is a renewal. */
export function isRenewalLike(opp: CanonicalOpportunity): boolean {
  return String(opp.type ?? '')
    .toLowerCase()
    .includes('renewal');
}

export function isClosedOpportunity(opp: CanonicalOpportunity): boolean {
  const cat = (opp.forecastCategory ?? '').trim().toLowerCase();
  if (cat === 'closed' || cat === 'closed won' || cat === 'closed lost') return true;
  return String(opp.stageName ?? '')
    .trim()
    .toLowerCase()
    .includes('closed');
}

export function closedOpportunityOutcome(
  opp: CanonicalOpportunity,
): 'won' | 'lost' | 'other' | null {
  if (!isClosedOpportunity(opp)) return null;
  const cat = (opp.forecastCategory ?? '').trim().toLowerCase();
  const stage = String(opp.stageName ?? '').trim().toLowerCase();
  const blob = `${cat} ${stage}`;
  if (blob.includes('lost')) return 'lost';
  if (blob.includes('won')) return 'won';
  return 'other';
}

function managerForecastMostLikelyUSD(opp: CanonicalOpportunity): number | null {
  if (opp.forecastMostLikelyOverride != null) return opp.forecastMostLikelyOverride;
  return opp.forecastMostLikely;
}

/** True when SFDC marks operational full churn (Churn Risk = Confirmed Full Churn). */
export function isKnownChurnOpportunity(opp: CanonicalOpportunity): boolean {
  return isRenewalLike(opp) && isOperationalFullChurnOpportunity(opp);
}

/**
 * Saveable-book full churn: SFDC Confirmed Full Churn, or closed-lost renewal.
 * Churn-notice-submitted dates are excluded — related workflow, not the marker.
 */
function isFullChurnSignal(opp: CanonicalOpportunity): boolean {
  if (isOperationalFullChurnOpportunity(opp)) return true;
  return isClosedOpportunity(opp) && closedOpportunityOutcome(opp) === 'lost';
}

/**
 * Closed-won renewed revenue on renewal opps.
 *
 * SFDC often duplicates the billing delta into both `ACV__c` and
 * `fml_DerivedACVDelta_USD__c`. When acv ≈ acvDelta and both are smaller
 * than ATR, the fields represent a signed change on ATR — not a standalone
 * post-renewal total (Vocera / SumUp pattern in production data).
 *
 * When acv is a plausible post-renewal total (≈ ATR or no delta), use acv.
 * True downsells with negative delta and small acv use acv directly.
 */
function renewedFromClosedWon(opp: CanonicalOpportunity, atr: number): number {
  const acv = opp.acv;
  const ad = opp.acvDelta;

  if (
    ad != null &&
    acv != null &&
    Math.abs(acv - ad) <= 1 &&
    atr > 0
  ) {
    return Math.max(0, atr + ad);
  }

  if (acv != null && acv >= 0) {
    if (ad == null || acv >= atr - EPSILON) return acv;
    if (ad < 0 && acv <= atr) return acv;
  }

  if (ad != null) return Math.max(0, atr + ad);
  if (acv != null && acv >= 0) return acv;
  return Math.max(0, atr);
}

/**
 * Derive renewed revenue for one renewal opportunity.
 *
 * Closed won: `acv` when set, else `max(0, ATR + acvDelta)`.
 * Open / forecast: manager ML as signed delta on ATR, else `acvDelta`, else flat at ATR.
 * Full churn signals → 0.
 */
export function deriveRenewedRevenueUSD(
  opp: CanonicalOpportunity,
  view: AccountView,
): number {
  const atr = opp.availableToRenewUSD ?? 0;
  if (!isRenewalLike(opp)) return 0;
  if (isKnownChurnOpportunity(opp)) return 0;
  if (isFullChurnSignal(opp)) return 0;

  const closed = closedOpportunityOutcome(opp);
  if (closed === 'won') {
    return renewedFromClosedWon(opp, atr);
  }

  if (closed === 'other' && isClosedOpportunity(opp)) {
    const ml = managerForecastMostLikelyUSD(opp);
    if (ml != null && ml <= 0) return Math.max(0, atr + ml);
    if (opp.acv != null) return Math.max(0, opp.acv);
    return Math.max(0, atr + (opp.acvDelta ?? 0));
  }

  const ml = managerForecastMostLikelyUSD(opp);
  if (ml != null) return Math.max(0, atr + ml);

  const ad = opp.acvDelta;
  if (ad != null) return Math.max(0, atr + ad);

  return Math.max(0, atr);
}

export function classifyRenewalOutcome(
  opp: CanonicalOpportunity,
  view: AccountView,
  asOfDate: string,
): RenewalOutcome {
  const atrVal = opp.availableToRenewUSD ?? 0;
  const renewed = deriveRenewedRevenueUSD(opp, view);
  const closedLost =
    isClosedOpportunity(opp) && closedOpportunityOutcome(opp) === 'lost';

  if (
    isOperationalFullChurnOpportunity(opp) ||
    (closedLost && renewed <= EPSILON && atrVal > EPSILON)
  ) {
    return 'full_churn';
  }

  // Open renewals stay pending/pushed regardless of forecast shape — downsell
  // / expansion are quarter-close outcomes for closed deals only.
  if (!isClosedOpportunity(opp)) {
    if (opp.closeDate && opp.closeDate < asOfDate.slice(0, 10)) return 'pushed';
    return 'pending';
  }

  if (renewed + EPSILON < atrVal) return 'downsell';
  if (renewed > atrVal + EPSILON) return 'expanded';
  return 'flat';
}

/** Classify at account level from aggregated ATR / renewed across in-scope opps. */
export function classifyAccountOutcome(
  atrUSD: number,
  renewedRevenueUSD: number,
  oppOutcomes: RenewalOutcome[],
  asOfDate: string,
  hasOpenOpp: boolean,
  latestCloseDate: string | null,
): RenewalOutcome {
  if (oppOutcomes.includes('full_churn')) return 'full_churn';
  if (renewedRevenueUSD + EPSILON < atrUSD) {
    if (hasOpenOpp) {
      if (latestCloseDate && latestCloseDate < asOfDate.slice(0, 10)) return 'pushed';
      return 'pending';
    }
    return 'downsell';
  }
  if (renewedRevenueUSD > atrUSD + EPSILON) return 'expanded';

  if (hasOpenOpp) {
    if (latestCloseDate && latestCloseDate < asOfDate.slice(0, 10)) return 'pushed';
    return 'pending';
  }

  return 'flat';
}

function oppInQuarters(
  opp: CanonicalOpportunity,
  quarterKeys: Set<string> | null,
  quarterKeyFn: (iso: string | null | undefined) => string | null,
): boolean {
  if (quarterKeys === null) return isRenewalLike(opp);
  const key = quarterKeyFn(opp.closeDate);
  return key !== null && quarterKeys.has(key) && isRenewalLike(opp);
}

function usageIndicator(view: AccountView): string | null {
  const mins = view.account.engagementMinutes30d;
  if (mins == null) return null;
  if (mins < 10) return 'Low engagement';
  if (mins < 50) return 'Moderate engagement';
  return 'Active engagement';
}

function riskScoreSummary(view: AccountView): {
  confidence: 'high' | 'low' | null;
  signals: RenewalRiskSignalSummary[];
} {
  const rs = view.riskScore;
  if (!rs) return { confidence: null, signals: [] };
  return {
    confidence: rs.confidence,
    signals: rs.signals.map((s) => ({
      label: s.label,
      points: s.points,
      source: s.source,
    })),
  };
}

function overallAssessment(view: AccountView): string | null {
  return view.account.cerebroRiskCategory ?? null;
}

function overallAssessmentDetail(view: AccountView): string | null {
  const analysis = view.account.cerebroRiskAnalysis?.trim();
  if (analysis) return analysis;

  const flags = Object.entries(view.account.cerebroRisks ?? {})
    .filter(([, atRisk]) => atRisk === true)
    .map(([key]) => key.replace(/Risk$/, ''));
  if (flags.length > 0 && view.account.cerebroRiskCategory) {
    return `Cerebro overall assessment: ${view.account.cerebroRiskCategory} — ${flags.join(', ')} risk signal${flags.length === 1 ? '' : 's'} flagged.`;
  }
  return null;
}

/** Representative score aligned to Cerebro Overall Assessment category bands. */
function cerebroAssessmentScore(category: string | null | undefined): number | null {
  switch (category) {
    case 'Critical':
      return 88;
    case 'High':
      return 63;
    case 'Medium':
      return 38;
    case 'Low':
      return 12;
    default:
      return null;
  }
}

/** Sort weight for Overall Assessment category (higher = more severe). */
export function overallAssessmentSortRank(category: string | null | undefined): number {
  switch (category) {
    case 'Critical':
      return 4;
    case 'High':
      return 3;
    case 'Medium':
      return 2;
    case 'Low':
      return 1;
    default:
      return 0;
  }
}

/** True when Cerebro Overall Assessment is Critical or High (at-risk band). */
export function isOverallAssessmentAtRisk(category: string | null | undefined): boolean {
  return category === 'Critical' || category === 'High';
}

/** Open renewal opps flagged at-risk by Cerebro Overall Assessment. */
export function filterAtRiskByOverallAssessment(rows: RenewalOppRow[]): RenewalOppRow[] {
  return rows.filter(
    (r) => isOpenRenewalOppRow(r) && isOverallAssessmentAtRisk(r.overallAssessment),
  );
}

/** Open renewal opps with close date within the next N calendar days. */
export function filterUpcomingRenewals(
  rows: RenewalOppRow[],
  horizonDays: number,
  asOfDate: string = new Date().toISOString(),
): RenewalOppRow[] {
  const today = Date.parse(asOfDate.slice(0, 10));
  const horizon = today + horizonDays * 86_400_000;
  return rows.filter((r) => {
    if (!isOpenRenewalOppRow(r) || !r.closeDate) return false;
    const close = Date.parse(r.closeDate);
    if (!Number.isFinite(close)) return false;
    return close >= today && close <= horizon;
  });
}

function engagementMetrics(view: AccountView, asOfDate: string) {
  const slack = lastHumanSlackPost(view.account, asOfDate);
  const engagement = lastHumanCustomerEngagement(view.account, asOfDate);
  return {
    daysSinceSlackUpdate: slack?.daysSince ?? daysSinceLastSlackChannelUpdate(view.account, asOfDate),
    slackLastTouch: toEngagementLastTouch(slack),
    daysSinceCustomerEngagement:
      engagement?.daysSince ?? daysSinceLastCustomerEngagement(view.account, asOfDate),
    customerEngagementLastTouch: toEngagementLastTouch(engagement),
  };
}

function pickReason(view: AccountView, opp: CanonicalOpportunity): string | null {
  return (
    opp.churnDownsellReason ??
    view.account.churnReasonSummary ??
    view.account.churnReason ??
    null
  );
}

function pickNextStep(opp: CanonicalOpportunity): string | null {
  return opp.scNextSteps ?? opp.flmNotes ?? opp.slmNotes ?? null;
}

function pickLastActivity(view: AccountView, opp: CanonicalOpportunity): string | null {
  const candidates = [
    view.account.cseSentimentLastUpdated,
    opp.lastUpdated,
    view.account.cseSentimentCommentaryLastUpdated,
  ].filter(Boolean) as string[];
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function sfAccountUrl(view: AccountView): string | null {
  const link = view.account.sourceLinks?.find((l) => l.source === 'salesforce');
  return link?.url ?? null;
}

function sfOpportunityUrl(opportunityId: string): string {
  return `https://zuora.lightning.force.com/lightning/r/Opportunity/${opportunityId}/view`;
}

export function buildKnownChurnOppRows(
  views: AccountView[],
  quarterKeys: Set<string> | null,
  quarterKeyFn: (iso: string | null | undefined) => string | null,
): KnownChurnOppRow[] {
  const rows: KnownChurnOppRow[] = [];
  for (const view of views) {
    for (const opp of view.opportunities) {
      if (!isKnownChurnOpportunity(opp)) continue;
      if (!oppInQuarters(opp, quarterKeys, quarterKeyFn)) continue;
      rows.push({
        opportunityId: opp.opportunityId,
        opportunityName: opp.opportunityName,
        accountId: view.account.accountId,
        accountName: view.account.accountName,
        cseName: view.account.assignedCSE?.name ?? null,
        accountOwner: view.account.accountOwner?.name ?? null,
        closeDate: opp.closeDate,
        stageName: opp.stageName,
        churnRisk: opp.churnRisk ?? CONFIRMED_FULL_CHURN_RISK,
        atrUSD: opp.availableToRenewUSD ?? 0,
        knownChurnUSD: opp.knownChurnUSD ?? 0,
        reason: pickReason(view, opp),
        salesforceUrl: sfAccountUrl(view),
      });
    }
  }
  return rows.sort((a, b) => b.atrUSD - a.atrUSD);
}

export function summarizeKnownChurn(rows: KnownChurnOppRow[]): KnownChurnSummary {
  const accountIds = new Set(rows.map((r) => r.accountId));
  return {
    accountCount: accountIds.size,
    opportunityCount: rows.length,
    atrUSD: rows.reduce((s, r) => s + r.atrUSD, 0),
    knownChurnUSD: rows.reduce((s, r) => s + r.knownChurnUSD, 0),
  };
}

export function buildRenewalOppRows(
  views: AccountView[],
  quarterKeys: Set<string> | null,
  quarterKeyFn: (iso: string | null | undefined) => string | null,
  asOfDate: string,
): RenewalOppRow[] {
  const rows: RenewalOppRow[] = [];
  for (const view of views) {
    for (const opp of view.opportunities) {
      if (isKnownChurnOpportunity(opp)) continue;
      if (!oppInQuarters(opp, quarterKeys, quarterKeyFn)) continue;
      const atr = opp.availableToRenewUSD ?? 0;
      if (atr <= 0 && !isFullChurnSignal(opp)) continue;

      const renewed = deriveRenewedRevenueUSD(opp, view);
      const outcome = classifyRenewalOutcome(opp, view, asOfDate);
      const churned = outcome === 'full_churn' ? atr : 0;
      const isOpen = outcome === 'pending' || outcome === 'pushed';
      const downsell =
        outcome === 'downsell'
          ? Math.max(0, atr - renewed)
          : isOpen && renewed + EPSILON < atr
            ? Math.max(0, atr - renewed)
            : 0;
      const downsellPct =
        outcome === 'downsell' && atr > 0 ? (downsell / atr) * 100 : null;
      const risk = riskScoreSummary(view);
      const engagement = engagementMetrics(view, asOfDate);

      rows.push({
        opportunityId: opp.opportunityId,
        opportunityName: opp.opportunityName,
        accountId: view.account.accountId,
        accountName: view.account.accountName,
        cseName: view.account.assignedCSE?.name ?? null,
        accountOwner: view.account.accountOwner?.name ?? null,
        cseSentiment: view.account.cseSentiment ?? null,
        closeDate: opp.closeDate,
        stageName: opp.stageName,
        renewalStatus: opp.forecastCategory ?? opp.stageName,
        atrUSD: atr,
        renewedRevenueUSD: renewed,
        churnedAtrUSD: churned,
        downsellAmountUSD: downsell,
        downsellPct,
        forecastMostLikelyUSD: managerForecastMostLikelyUSD(opp),
        outcome,
        overallAssessment: overallAssessment(view),
        overallAssessmentDetail: overallAssessmentDetail(view),
        healthScore:
          cerebroAssessmentScore(view.account.cerebroRiskCategory) ??
          view.riskScore?.score ??
          null,
        healthBand:
          view.account.cerebroRiskCategory ??
          view.riskScore?.band ??
          view.risk.level ??
          null,
        riskScoreConfidence: view.account.cerebroRiskCategory
          ? 'high'
          : risk.confidence,
        riskSignals: risk.signals,
        usageIndicator: usageIndicator(view),
        reason: pickReason(view, opp),
        nextStep: pickNextStep(opp),
        lastActivityDate: pickLastActivity(view, opp),
        daysSinceSlackUpdate: engagement.daysSinceSlackUpdate,
        slackLastTouch: engagement.slackLastTouch,
        daysSinceCustomerEngagement: engagement.daysSinceCustomerEngagement,
        customerEngagementLastTouch: engagement.customerEngagementLastTouch,
        salesforceUrl: sfAccountUrl(view),
        opportunitySalesforceUrl: sfOpportunityUrl(opp.opportunityId),
      });
    }
  }
  return rows;
}

/** Roll opp rows up to one row per account (multi-sub / multi-opp safe). */
export function buildRenewalAccountRows(
  oppRows: RenewalOppRow[],
  asOfDate: string = new Date().toISOString(),
): RenewalAccountRow[] {
  const byAccount = new Map<string, RenewalOppRow[]>();
  for (const row of oppRows) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(row);
    byAccount.set(row.accountId, list);
  }

  const accounts: RenewalAccountRow[] = [];
  for (const [accountId, opps] of byAccount) {
    const first = opps[0]!;
    const atrUSD = opps.reduce((s, o) => s + o.atrUSD, 0);
    const renewedRevenueUSD = opps.reduce((s, o) => s + o.renewedRevenueUSD, 0);
    const churnedAtrUSD = opps.reduce((s, o) => s + o.churnedAtrUSD, 0);
    const downsellAmountUSD = opps.reduce((s, o) => s + o.downsellAmountUSD, 0);
    const downsellPct =
      downsellAmountUSD > 0 && atrUSD > 0
        ? (downsellAmountUSD / atrUSD) * 100
        : null;

    const hasOpen = opps.some((o) => isOpenRenewalOppRow(o));
    const latestClose = opps
      .map((o) => o.closeDate)
      .filter(Boolean)
      .sort((a, b) => Date.parse(a!) - Date.parse(b!))[0] ?? null;

    const outcome = classifyAccountOutcome(
      atrUSD,
      renewedRevenueUSD,
      opps.map((o) => o.outcome),
      asOfDate,
      hasOpen,
      latestClose,
    );

    accounts.push({
      accountId,
      accountName: first.accountName,
      cseName: first.cseName,
      accountOwner: first.accountOwner,
      cseSentiment: first.cseSentiment,
      renewalDate: latestClose,
      renewalStatus: opps.map((o) => o.renewalStatus).join('; '),
      atrUSD,
      renewedRevenueUSD,
      churnedAtrUSD,
      downsellAmountUSD,
      downsellPct,
      outcome,
      overallAssessment: first.overallAssessment,
      overallAssessmentDetail: first.overallAssessmentDetail,
      healthScore: first.healthScore,
      healthBand: first.healthBand,
      riskScoreConfidence: first.riskScoreConfidence,
      riskSignals: first.riskSignals,
      usageIndicator: first.usageIndicator,
      reason: opps.map((o) => o.reason).find(Boolean) ?? null,
      nextStep: opps.map((o) => o.nextStep).find(Boolean) ?? null,
      lastActivityDate: opps
        .map((o) => o.lastActivityDate)
        .filter(Boolean)
        .sort((a, b) => Date.parse(b!) - Date.parse(a!))[0] ?? null,
      daysSinceSlackUpdate: first.daysSinceSlackUpdate,
      slackLastTouch: first.slackLastTouch,
      daysSinceCustomerEngagement: first.daysSinceCustomerEngagement,
      customerEngagementLastTouch: first.customerEngagementLastTouch,
      opportunityCount: opps.length,
      salesforceUrl: first.salesforceUrl,
      opportunities: opps,
    });
  }
  return accounts.sort((a, b) => b.atrUSD - a.atrUSD);
}

function summarizeReasons(
  accounts: RenewalAccountRow[],
  outcome: RenewalOutcome,
): ReasonSummary[] {
  const map = new Map<string, { count: number; atr: number }>();
  for (const a of accounts.filter((x) => x.outcome === outcome && isClosedRenewalOutcome(x.outcome))) {
    const reason = (a.reason ?? 'Unspecified').trim() || 'Unspecified';
    const cur = map.get(reason) ?? { count: 0, atr: 0 };
    cur.count += 1;
    cur.atr += a.atrUSD;
    map.set(reason, cur);
  }
  return Array.from(map.entries())
    .map(([reason, v]) => ({
      reason,
      accountCount: v.count,
      atrUSD: v.atr,
    }))
    .sort((a, b) => b.atrUSD - a.atrUSD);
}

function pipelineStatsFromAccounts(accounts: RenewalAccountRow[]) {
  const opps = accounts.flatMap((a) => a.opportunities);
  const openOpps = opps.filter((o) => isOpenRenewalOppRow(o));
  return {
    openRenewalCount: new Set(openOpps.map((o) => o.accountId)).size,
    openRenewalAtrUSD: openOpps.reduce((s, o) => s + o.atrUSD, 0),
    pushedRenewalCount: openOpps.filter((o) => o.outcome === 'pushed').length,
  };
}

function aggregateFromAccounts(accounts: RenewalAccountRow[]): RenewalMetricsSummary {
  const atrUpForRenewalUSD = accounts.reduce((s, a) => s + a.atrUSD, 0);
  const renewedRevenueUSD = accounts.reduce((s, a) => s + a.renewedRevenueUSD, 0);
  const atrChurnedUSD = accounts.reduce((s, a) => s + a.churnedAtrUSD, 0);
  const downsellAmountUSD = accounts.reduce((s, a) => s + a.downsellAmountUSD, 0);

  const fullChurnAccountCount = accounts.filter((a) => a.outcome === 'full_churn').length;
  const downsellAccountCount = accounts.filter((a) => a.outcome === 'downsell').length;
  const accountsUpForRenewal = accounts.length;

  const outcomeCounts: RenewalOutcomeCounts = {
    flat: accounts.filter((a) => a.outcome === 'flat').length,
    downsell: downsellAccountCount,
    full_churn: fullChurnAccountCount,
    expanded: accounts.filter((a) => a.outcome === 'expanded').length,
    pending: accounts.filter((a) => a.outcome === 'pending').length,
    pushed: accounts.filter((a) => a.outcome === 'pushed').length,
  };

  const closedAccounts = accounts.filter((a) => isClosedRenewalOutcome(a.outcome));
  const retrospectiveOutcomeCounts: RenewalOutcomeCounts = {
    flat: closedAccounts.filter((a) => a.outcome === 'flat').length,
    downsell: closedAccounts.filter((a) => a.outcome === 'downsell').length,
    full_churn: closedAccounts.filter((a) => a.outcome === 'full_churn').length,
    expanded: closedAccounts.filter((a) => a.outcome === 'expanded').length,
    pending: 0,
    pushed: 0,
  };

  const expansionUSD = accounts
    .filter((a) => a.outcome === 'expanded')
    .reduce((s, a) => s + Math.max(0, a.renewedRevenueUSD - a.atrUSD), 0);

  return {
    atrUpForRenewalUSD,
    renewedRevenueUSD,
    atrChurnedUSD,
    downsellAmountUSD,
    fullLogoChurnRate:
      accountsUpForRenewal > 0 ? fullChurnAccountCount / accountsUpForRenewal : null,
    fullChurnAccountCount,
    downsellAccountRate:
      accountsUpForRenewal > 0 ? downsellAccountCount / accountsUpForRenewal : null,
    downsellAccountCount,
    grossRevenueRetentionPct:
      atrUpForRenewalUSD > 0 ? renewedRevenueUSD / atrUpForRenewalUSD : null,
    accountsUpForRenewal,
    outcomeCounts,
    retrospectiveOutcomeCounts,
    ...pipelineStatsFromAccounts(accounts),
    bridge: {
      startingAtrUSD: atrUpForRenewalUSD,
      fullChurnUSD: atrChurnedUSD,
      downsellUSD: downsellAmountUSD,
      expansionUSD,
      endingRenewedUSD: renewedRevenueUSD,
    },
    topChurnReasonsByAtr: summarizeReasons(accounts, 'full_churn'),
    topDownsellReasonsByAtr: summarizeReasons(accounts, 'downsell'),
    topChurnReasonsByCount: summarizeReasons(accounts, 'full_churn').sort(
      (a, b) => b.accountCount - a.accountCount,
    ),
    knownChurn: { accountCount: 0, opportunityCount: 0, atrUSD: 0, knownChurnUSD: 0 },
    priorPeriod: null,
  };
}

export function buildRenewalMetrics(
  opts: BuildRenewalMetricsOpts & {
    quarterKeyFn: (iso: string | null | undefined) => string | null;
  },
): RenewalMetricsSummary {
  const asOfDate = opts.asOfDate ?? new Date().toISOString();
  const knownChurnRows = buildKnownChurnOppRows(
    opts.views,
    opts.quarterKeys,
    opts.quarterKeyFn,
  );
  const oppRows = buildRenewalOppRows(
    opts.views,
    opts.quarterKeys,
    opts.quarterKeyFn,
    asOfDate,
  );
  const accounts = buildRenewalAccountRows(oppRows, asOfDate);
  const summary = aggregateFromAccounts(accounts);
  summary.knownChurn = summarizeKnownChurn(knownChurnRows);

  if (opts.priorQuarterKeys && opts.priorQuarterKeys.size > 0) {
    const priorKey = [...opts.priorQuarterKeys][0]!;
    const priorAsOf = asOfDateForQuarter(priorKey, asOfDate);
    const priorKnownChurnRows = buildKnownChurnOppRows(
      opts.views,
      opts.priorQuarterKeys,
      opts.quarterKeyFn,
    );
    const priorOppRows = buildRenewalOppRows(
      opts.views,
      opts.priorQuarterKeys,
      opts.quarterKeyFn,
      priorAsOf,
    );
    const priorAccounts = buildRenewalAccountRows(priorOppRows, priorAsOf);
    const prior = aggregateFromAccounts(priorAccounts);
    summary.priorPeriod = {
      atrUpForRenewalUSD: prior.atrUpForRenewalUSD,
      renewedRevenueUSD: prior.renewedRevenueUSD,
      atrChurnedUSD: prior.atrChurnedUSD,
      downsellAmountUSD: prior.downsellAmountUSD,
      fullLogoChurnRate: prior.fullLogoChurnRate,
      fullChurnAccountCount: prior.fullChurnAccountCount,
      downsellAccountRate: prior.downsellAccountRate,
      downsellAccountCount: prior.downsellAccountCount,
      grossRevenueRetentionPct: prior.grossRevenueRetentionPct,
      accountsUpForRenewal: prior.accountsUpForRenewal,
      outcomeCounts: prior.outcomeCounts,
      bridge: prior.bridge,
      knownChurn: summarizeKnownChurn(priorKnownChurnRows),
      topChurnReasonsByAtr: prior.topChurnReasonsByAtr,
      topDownsellReasonsByAtr: prior.topDownsellReasonsByAtr,
      topChurnReasonsByCount: prior.topChurnReasonsByCount,
    };
  }

  return summary;
}

export interface QuarterTrendPoint {
  quarterKey: string;
  quarterLabel: string;
  atrUpForRenewalUSD: number;
  renewedRevenueUSD: number;
  atrChurnedUSD: number;
  downsellAmountUSD: number;
  grossRevenueRetentionPct: number | null;
  fullLogoChurnRate: number | null;
  accountsUpForRenewal: number;
}

/** Metrics per fiscal quarter for trend charts (trailing window). */
export function buildRenewalQuarterTrend(
  views: AccountView[],
  quarterKeys: string[],
  quarterKeyFn: (iso: string | null | undefined) => string | null,
  labelFn: (key: string) => string = (k) => k,
  todayIso?: string,
): QuarterTrendPoint[] {
  const today = todayIso ?? new Date().toISOString();
  return quarterKeys.map((key) => {
    const quarterAsOf = asOfDateForQuarter(key, today);
    const metrics = buildRenewalMetrics({
      views,
      quarterKeys: new Set([key]),
      quarterKeyFn,
      asOfDate: quarterAsOf,
    });
    return {
      quarterKey: key,
      quarterLabel: labelFn(key),
      atrUpForRenewalUSD: metrics.atrUpForRenewalUSD,
      renewedRevenueUSD: metrics.renewedRevenueUSD,
      atrChurnedUSD: metrics.atrChurnedUSD,
      downsellAmountUSD: metrics.downsellAmountUSD,
      grossRevenueRetentionPct: metrics.grossRevenueRetentionPct,
      fullLogoChurnRate: metrics.fullLogoChurnRate,
      accountsUpForRenewal: metrics.accountsUpForRenewal,
    };
  });
}

/** Accounts with upcoming renewal ATR in the next N days (at-risk pipeline). */
export function buildAtRiskPipeline(
  views: AccountView[],
  horizonDays: 30 | 60 | 90,
  asOfDate: string = new Date().toISOString(),
): RenewalAccountRow[] {
  const today = Date.parse(asOfDate.slice(0, 10));
  const horizon = today + horizonDays * 86_400_000;
  const filtered = views.filter((v) => {
    if (v.daysToRenewal == null) return false;
    const close = v.opportunities
      .filter(isRenewalLike)
      .map((o) => o.closeDate)
      .filter(Boolean)
      .map((d) => Date.parse(d!))
      .sort((a, b) => a - b)[0];
    if (close == null) return false;
    return close >= today && close <= horizon;
  });

  const oppRows = buildRenewalOppRows(filtered, null, () => null, asOfDate).filter(
    (r) => r.outcome === 'pending' || r.outcome === 'pushed',
  );
  const accounts = buildRenewalAccountRows(oppRows, asOfDate);
  return accounts.filter(
    (a) =>
      (a.healthScore != null && a.healthScore >= 50) ||
      a.outcome === 'pushed' ||
      !a.nextStep ||
      (a.usageIndicator?.includes('Low') ?? false),
  );
}
