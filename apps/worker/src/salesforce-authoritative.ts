import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { fiscalQuarterFromDate } from '@mdas/cta-engine';

export interface MergedSnapshotData {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
}

export interface SalesforceAuthoritativeOptions {
  /** Refresh calendar date (YYYY-MM-DD) — scopes retained prior opps. */
  asOfDate?: string;
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

function shouldRetainPriorChurnOpportunity(
  opp: CanonicalOpportunity,
  asOfDate: string,
  sfOppIds: Set<string>,
): boolean {
  if (sfOppIds.has(opp.opportunityId)) return false;
  const fq = fiscalQuarterFromDate(opp.closeDate);
  const currentFq = fiscalQuarterFromDate(asOfDate);
  if (!fq || !currentFq || fq.key !== currentFq.key) return false;
  return isRenewalLike(opp) && hasDownForecastSignal(opp);
}

/**
 * When Salesforce succeeds, its fetch is the authoritative record set for
 * Expand 3 accounts and opportunities. Prior snapshots (via
 * local-snapshots) may still carry rows SFDC no longer returns — e.g.
 * opps that aged out of an old CloseDate window — and a plain merge would
 * leave that stale data in place. SFDC is lightweight enough to pull the
 * full franchise every refresh, so drop anything not in the latest SF
 * payload while keeping Glean enrichments already merged onto SF accounts.
 *
 * Accounts referenced by SF opportunities are retained even when the SF
 * account query omits them (e.g. Customer_Status__c no longer matches the
 * ingest filter but the renewal opp is still on the franchise book).
 *
 * In-quarter renewal downsell/churn opps missing from the SF opp payload are
 * carried forward from the merged prior snapshot so churn Flash does not
 * drop when SFDC transiently omits rows between refreshes.
 */
export function applySalesforceAuthoritativeSnapshot(
  merged: MergedSnapshotData,
  salesforceResult: Partial<MergedSnapshotData> | undefined,
  options: SalesforceAuthoritativeOptions = {},
): MergedSnapshotData {
  const sfAccounts = salesforceResult?.accounts ?? [];
  const sfOpps = salesforceResult?.opportunities ?? [];
  if (sfAccounts.length === 0 && sfOpps.length === 0) return merged;

  const sfAccountIds = new Set(sfAccounts.map((a) => a.accountId));
  const sfOppIds = new Set(sfOpps.map((o) => o.opportunityId));
  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);

  const retainedPriorOpps =
    sfOpps.length > 0
      ? merged.opportunities.filter((o) =>
          shouldRetainPriorChurnOpportunity(o, asOfDate, sfOppIds),
        )
      : [];

  const opportunities =
    sfOpps.length > 0
      ? [...(sfOpps as CanonicalOpportunity[]), ...retainedPriorOpps]
      : merged.opportunities;

  const oppAccountIds = new Set(opportunities.map((o) => o.accountId));
  const accounts =
    sfAccountIds.size > 0 || oppAccountIds.size > 0
      ? merged.accounts.filter(
          (a) => sfAccountIds.has(a.accountId) || oppAccountIds.has(a.accountId),
        )
      : merged.accounts;

  return { accounts, opportunities };
}
