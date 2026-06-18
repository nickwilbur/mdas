import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { isConfirmedChurn, isConfirmedFullChurnRisk } from '@mdas/canonical';

export const EXPAND3_FRANCHISE = 'Expand 3';

/** Live Expand 3 customer statuses ingested from Salesforce. */
export const EXPAND3_ACTIVE_CUSTOMER_STATUSES = [
  'Live',
  'Implementing',
  'In Production',
] as const;

const CLOSED_RENEWAL_STAGE = /^(closed|won|lost|dead|churn)/i;

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
export function isActiveExpand3Account(
  account: CanonicalAccount,
  opportunities: CanonicalOpportunity[] = [],
): boolean {
  if (account.franchise !== EXPAND3_FRANCHISE) return false;
  if (isChurnCustomerStatus(account.customerStatus)) return false;
  if (account.cseSentiment === 'Confirmed Churn') return false;
  if (account.isConfirmedChurn) return false;
  if (isConfirmedChurn(account, opportunities)) return false;
  // SFDC churn reason with no open future renewal — effectively exited (e.g. WellSky M&A).
  if (account.churnReason?.trim() && !hasFutureOpenRenewal(opportunities)) return false;
  return true;
}

/**
 * Restrict snapshot persistence to active Expand 3 accounts and their
 * opportunities. Called by the worker before every refresh write.
 */
export function filterExpand3Snapshot(
  data: Expand3SnapshotData,
): Expand3SnapshotData {
  const oppsByAccount = new Map<string, CanonicalOpportunity[]>();
  for (const o of data.opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }

  const accounts = data.accounts.filter((a) =>
    isActiveExpand3Account(a, oppsByAccount.get(a.accountId) ?? []),
  );
  const accountIds = new Set(accounts.map((a) => a.accountId));
  const opportunities = data.opportunities.filter((o) => accountIds.has(o.accountId));

  return { accounts, opportunities };
}
