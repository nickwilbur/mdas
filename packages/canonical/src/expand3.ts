import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';

const CONFIRMED_FULL_CHURN_RISK = 'Confirmed Full Churn';

function isConfirmedFullChurnRisk(churnRisk: string | null | undefined): boolean {
  return (
    String(churnRisk ?? '').trim().toLowerCase() ===
    CONFIRMED_FULL_CHURN_RISK.toLowerCase()
  );
}

function isConfirmedChurnAccount(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
): boolean {
  return (
    account.cseSentiment === 'Confirmed Churn' ||
    opps.some(
      (o) =>
        !!o.fullChurnNotificationToOwnerDate || !!o.fullChurnFinalEmailSentDate,
    )
  );
}

export const EXPAND3_FRANCHISE = 'Expand 3';

/** Live Expand 3 customer statuses ingested from Salesforce. */
export const EXPAND3_ACTIVE_CUSTOMER_STATUSES = [
  'Live',
  'Implementing',
  'In Production',
] as const;

const CLOSED_RENEWAL_STAGE = /^(closed|won|lost|dead|churn)/i;

/** Zuora fiscal quarter key (e.g. `2027-Q2`) from an ISO date. */
function fiscalQuarterKeyFromDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  let fy: number;
  let q: number;
  if (m === 1) {
    fy = y;
    q = 4;
  } else if (m <= 4) {
    fy = y + 1;
    q = 1;
  } else if (m <= 7) {
    fy = y + 1;
    q = 2;
  } else if (m <= 10) {
    fy = y + 1;
    q = 3;
  } else {
    fy = y + 1;
    q = 4;
  }
  return `${fy}-Q${q}`;
}

function isRenewalLike(opp: CanonicalOpportunity): boolean {
  return /renewal/i.test(opp.type ?? '');
}

function hasDownForecastSignal(opp: CanonicalOpportunity): boolean {
  if ((opp.knownChurnUSD ?? 0) > 0) return true;
  if (!isRenewalLike(opp)) return false;
  if (opp.forecastMostLikelyOverride != null) {
    return opp.forecastMostLikelyOverride < 0;
  }
  const ml = opp.forecastMostLikely;
  if (ml != null && ml < 0) return true;
  if (opp.acvDelta != null && opp.acvDelta < 0) return true;
  return false;
}

/** Matches Clari Churn & Downsell Total tab renewal rows. */
function isRenewalDownsellChurnOpp(opp: CanonicalOpportunity): boolean {
  return isRenewalLike(opp) && hasDownForecastSignal(opp);
}

function hasInQuarterChurnGridOpportunity(
  opportunities: CanonicalOpportunity[],
  asOfDate: string,
): boolean {
  const fq = fiscalQuarterKeyFromDate(asOfDate);
  if (!fq) return false;
  return opportunities.some((o) => {
    const oppFq = fiscalQuarterKeyFromDate(o.closeDate);
    return oppFq === fq && isRenewalDownsellChurnOpp(o);
  });
}

export function isChurnCustomerStatus(status: string | null | undefined): boolean {
  if (!status?.trim()) return false;
  return /churn/i.test(status);
}

/** Open renewal with a future close date — accounts without one are not in an active renewal cycle. */
export function hasFutureOpenRenewal(
  opportunities: CanonicalOpportunity[],
  now: number = Date.now(),
): boolean {
  const today = new Date(now).toISOString().slice(0, 10);
  return opportunities.some((o) => {
    if (!/renewal/i.test(o.type)) return false;
    if (!o.closeDate || o.closeDate < today) return false;
    if (CLOSED_RENEWAL_STAGE.test(o.stageName ?? '')) return false;
    if (isConfirmedFullChurnRisk(o.churnRisk)) return false;
    if (o.fullChurnNotificationToOwnerDate || o.fullChurnFinalEmailSentDate) return false;
    return true;
  });
}

export interface Expand3SnapshotData {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
}

/**
 * Returns true for accounts that belong in the MDAS Expand 3 book.
 * Excludes other franchises and customers that have already churned.
 */
export interface ActiveExpand3AccountOptions {
  /** Refresh calendar date — retains in-quarter churn-grid renewals on exited customers. */
  asOfDate?: string;
}

export function isActiveExpand3Account(
  account: CanonicalAccount,
  opportunities: CanonicalOpportunity[] = [],
  options: ActiveExpand3AccountOptions = {},
): boolean {
  if (account.franchise !== EXPAND3_FRANCHISE) return false;
  if (
    options.asOfDate &&
    hasInQuarterChurnGridOpportunity(opportunities, options.asOfDate)
  ) {
    return true;
  }
  if (isChurnCustomerStatus(account.customerStatus)) return false;
  if (account.cseSentiment === 'Confirmed Churn') return false;
  if (account.isConfirmedChurn) return false;
  if (isConfirmedChurnAccount(account, opportunities)) return false;
  // SFDC churn reason with no open future renewal — effectively exited (e.g. WellSky M&A).
  if (account.churnReason?.trim() && !hasFutureOpenRenewal(opportunities)) return false;
  return true;
}

/**
 * Restrict snapshot persistence to active Expand 3 accounts and their
 * opportunities. Called by the worker before every refresh write.
 */
export interface FilterExpand3SnapshotOptions {
  asOfDate?: string;
}

export function filterExpand3Snapshot(
  data: Expand3SnapshotData,
  options: FilterExpand3SnapshotOptions = {},
): Expand3SnapshotData {
  const oppsByAccount = new Map<string, CanonicalOpportunity[]>();
  for (const o of data.opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }

  const accounts = data.accounts.filter((a) =>
    isActiveExpand3Account(
      a,
      oppsByAccount.get(a.accountId) ?? [],
      options,
    ),
  );
  const accountIds = new Set(accounts.map((a) => a.accountId));
  const opportunities = data.opportunities.filter((o) => accountIds.has(o.accountId));

  return { accounts, opportunities };
}
