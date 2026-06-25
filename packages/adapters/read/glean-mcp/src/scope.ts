import type { CanonicalAccount, RefreshContext } from '@mdas/canonical';
import { latestSuccessfulRun, readSnapshotAccounts } from '@mdas/db';
import { isFreshEnoughToSkip, resolveGleanEnrichLimit } from '../../_shared/src/glean.js';

export interface GleanMcpScope {
  accounts: CanonicalAccount[];
  scopedAccounts: number;
  skippedFresh: number;
}

export async function resolveGleanMcpScope(
  ctx?: RefreshContext,
): Promise<GleanMcpScope | null> {
  let allAccounts: CanonicalAccount[];
  if (ctx?.priorRun) {
    allAccounts = ctx.priorRun.accounts;
  } else {
    const prior = await latestSuccessfulRun();
    if (!prior) return null;
    allAccounts = await readSnapshotAccounts(prior.id);
  }
  if (allAccounts.length === 0) return null;

  const limit = resolveGleanEnrichLimit();
  const scoped = limit > 0 ? allAccounts.slice(0, limit) : allAccounts;
  const accounts = scoped.filter(
    (a) => !isFreshEnoughToSkip(a.lastFetchedFromSource?.['glean-mcp']),
  );

  return {
    accounts,
    scopedAccounts: scoped.length,
    skippedFresh: scoped.length - accounts.length,
  };
}
