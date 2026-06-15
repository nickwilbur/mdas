import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';

export interface MergedSnapshotData {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
}

/**
 * When Salesforce succeeds, its fetch is the authoritative record set for
 * Expand 3 accounts and opportunities. Prior snapshots (via
 * local-snapshots) may still carry rows SFDC no longer returns — e.g.
 * opps that aged out of an old CloseDate window — and a plain merge would
 * leave that stale data in place. SFDC is lightweight enough to pull the
 * full franchise every refresh, so drop anything not in the latest SF
 * payload while keeping Glean enrichments already merged onto SF accounts.
 */
export function applySalesforceAuthoritativeSnapshot(
  merged: MergedSnapshotData,
  salesforceResult: Partial<MergedSnapshotData> | undefined,
): MergedSnapshotData {
  const sfAccounts = salesforceResult?.accounts ?? [];
  const sfOpps = salesforceResult?.opportunities ?? [];
  if (sfAccounts.length === 0 && sfOpps.length === 0) return merged;

  const sfAccountIds = new Set(sfAccounts.map((a) => a.accountId));
  const sfOppIds = new Set(sfOpps.map((o) => o.opportunityId));
  const accounts =
    sfAccountIds.size > 0
      ? merged.accounts.filter((a) => sfAccountIds.has(a.accountId))
      : merged.accounts;
  // Mirror the account path: keep merged opportunity rows (SF field
  // values + provenance from prior adapters) but drop anything SF no
  // longer returns. Raw `sfOpps` would discard merged sourceLinks;
  // when SF succeeds with accounts but an empty opp payload, filter
  // by account id so orphan opps for dropped accounts do not linger.
  const opportunities =
    sfOppIds.size > 0
      ? merged.opportunities.filter((o) => sfOppIds.has(o.opportunityId))
      : sfAccountIds.size > 0
        ? merged.opportunities.filter((o) => sfAccountIds.has(o.accountId))
        : merged.opportunities;

  return { accounts, opportunities };
}
