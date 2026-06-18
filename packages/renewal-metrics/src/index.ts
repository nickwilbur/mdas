import type { AccountView, CanonicalOpportunity } from '@mdas/canonical';
import { isConfirmedFullChurnRisk, CONFIRMED_FULL_CHURN_RISK } from '@mdas/canonical';
import { isConfirmedChurn } from '@mdas/canonical';
import { asOfDateForQuarter, enumerateFiscalQuarterKeys } from './fiscal.js';

export {
  asOfDateForQuarter,
  enumerateFiscalQuarterKeys,
  fiscalQuarterEnd,
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

export interface RenewalOppRow {
  opportunityId: string;
  opportunityName: string;
  accountId: string;
  accountName: string;
  cseName: string | null;
  accountOwner: string | null;
  closeDate: string | null;
  stageName: string;
  renewalStatus: string;
  atrUSD: number;
  renewedRevenueUSD: number;
  churnedAtrUSD: number;
  downsellAmountUSD: number;
  downsellPct: number | null;
  outcome: RenewalOutcome;
  healthScore: number | null;
  healthBand: string | null;
  usageIndicator: string | null;
  reason: string | null;
  nextStep: string | null;
  lastActivityDate: string | null;
  salesforceUrl: string | null;
}

export interface RenewalAccountRow {
  accountId: string;
  accountName: string;
  cseName: string | null;
  accountOwner: string | null;
  renewalDate: string | null;
  renewalStatus: string;
  atrUSD: number;
  renewedRevenueUSD: number;
  churnedAtrUSD: number;
  downsellAmountUSD: number;
  downsellPct: number | null;
  outcome: RenewalOutcome;
  healthScore: number | null;
  healthBand: string | null;
  usageIndicator: string | null;
  reason: string | null;
  nextStep: string | null;
  lastActivityDate: string | null;
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
  /** Bridge components — reconcile to renewedRevenueUSD. */
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

const EPSILON = 0.01;

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

/** True when SFDC Churn_Risk__c is Confirmed Full Churn on a renewal opportunity. */
export function isKnownChurnOpportunity(opp: CanonicalOpportunity): boolean {
  return isRenewalLike(opp) && isConfirmedFullChurnRisk(opp.churnRisk);
}

function isFullChurnSignal(opp: CanonicalOpportunity, view: AccountView): boolean {
  // Known churn is excluded upstream — do not double-count here.
  if (opp.fullChurnNotificationToOwnerDate || opp.fullChurnFinalEmailSentDate) return true;
  if (closedOpportunityOutcome(opp) === 'lost') return true;
  if (isConfirmedChurn(view.account, view.opportunities) && isClosedOpportunity(opp)) return true;
  return false;
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
  if (isFullChurnSignal(opp, view)) return 0;

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

  // Revenue-based outcomes apply to open and closed renewals alike.
  if (renewed <= EPSILON && atrVal > EPSILON) return 'full_churn';
  if (renewed + EPSILON < atrVal) return 'downsell';
  if (renewed > atrVal + EPSILON) return 'expanded';

  if (!isClosedOpportunity(opp)) {
    if (opp.closeDate && opp.closeDate < asOfDate.slice(0, 10)) return 'pushed';
    return 'pending';
  }

  return 'flat';
}

/** Classify at account level from aggregated ATR / renewed across in-scope opps. */
export function classifyAccountOutcome(
  atrUSD: number,
  renewedRevenueUSD: number,
  _oppOutcomes: RenewalOutcome[],
  asOfDate: string,
  hasOpenOpp: boolean,
  latestCloseDate: string | null,
): RenewalOutcome {
  if (renewedRevenueUSD <= EPSILON && atrUSD > EPSILON) return 'full_churn';
  if (renewedRevenueUSD + EPSILON < atrUSD) return 'downsell';
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
      if (atr <= 0 && !isFullChurnSignal(opp, view)) continue;

      const renewed = deriveRenewedRevenueUSD(opp, view);
      const outcome = classifyRenewalOutcome(opp, view, asOfDate);
      const churned = outcome === 'full_churn' ? atr : 0;
      const downsell =
        outcome === 'downsell' ? Math.max(0, atr - renewed) : 0;
      const downsellPct =
        outcome === 'downsell' && atr > 0 ? (downsell / atr) * 100 : null;

      rows.push({
        opportunityId: opp.opportunityId,
        opportunityName: opp.opportunityName,
        accountId: view.account.accountId,
        accountName: view.account.accountName,
        cseName: view.account.assignedCSE?.name ?? null,
        accountOwner: view.account.accountOwner?.name ?? null,
        closeDate: opp.closeDate,
        stageName: opp.stageName,
        renewalStatus: opp.forecastCategory ?? opp.stageName,
        atrUSD: atr,
        renewedRevenueUSD: renewed,
        churnedAtrUSD: churned,
        downsellAmountUSD: downsell,
        downsellPct,
        outcome,
        healthScore: view.riskScore?.score ?? null,
        healthBand: view.riskScore?.band ?? view.risk.level ?? null,
        usageIndicator: usageIndicator(view),
        reason: pickReason(view, opp),
        nextStep: pickNextStep(opp),
        lastActivityDate: pickLastActivity(view, opp),
        salesforceUrl: sfAccountUrl(view),
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

    const hasOpen = opps.some((o) => o.outcome === 'pending' || o.outcome === 'pushed');
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
      renewalDate: latestClose,
      renewalStatus: opps.map((o) => o.renewalStatus).join('; '),
      atrUSD,
      renewedRevenueUSD,
      churnedAtrUSD,
      downsellAmountUSD,
      downsellPct,
      outcome,
      healthScore: first.healthScore,
      healthBand: first.healthBand,
      usageIndicator: first.usageIndicator,
      reason: opps.map((o) => o.reason).find(Boolean) ?? null,
      nextStep: opps.map((o) => o.nextStep).find(Boolean) ?? null,
      lastActivityDate: opps
        .map((o) => o.lastActivityDate)
        .filter(Boolean)
        .sort((a, b) => Date.parse(b!) - Date.parse(a!))[0] ?? null,
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
  for (const a of accounts.filter((x) => x.outcome === outcome)) {
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
