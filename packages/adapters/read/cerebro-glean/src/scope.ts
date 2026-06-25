import type { CanonicalAccount, RefreshContext } from '@mdas/canonical';
import { latestSuccessfulRun, readSnapshotAccounts } from '@mdas/db';
import { isFreshEnoughToSkip, resolveGleanEnrichLimit } from '../../_shared/src/glean.js';

function hasAnyCerebroSignal(a: CanonicalAccount): boolean {
  if (a.cerebroRiskCategory) return true;
  const r = a.cerebroRisks;
  if (!r) return false;
  return Object.values(r).some((v) => v === true);
}

export interface CerebroGleanScope {
  toSearch: CanonicalAccount[];
  scopedAccounts: number;
  skippedFresh: number;
  skippedRestCovered: number;
  restAttempted: boolean;
}

export async function resolveCerebroGleanScope(
  ctx?: RefreshContext,
): Promise<CerebroGleanScope | null> {
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
  const scoped =
    limit === 0
      ? allAccounts
      : [...allAccounts]
          .sort((a, b) => {
            const aHas = hasAnyCerebroSignal(a) ? 1 : 0;
            const bHas = hasAnyCerebroSignal(b) ? 1 : 0;
            if (aHas !== bHas) return aHas - bHas;
            return (b.allTimeARR ?? 0) - (a.allTimeARR ?? 0);
          })
          .slice(0, limit);
  const priorAccounts = scoped.filter(
    (a) => !isFreshEnoughToSkip(a.lastFetchedFromSource?.cerebro),
  );
  const restCoverage = new Set(ctx?.cerebroRestCoverage?.enrichedAccountIds ?? []);
  const restAttempted = ctx?.cerebroRestCoverage?.restAttempted ?? false;
  const skippedRestCovered = priorAccounts.filter((a) =>
    restCoverage.has(a.accountId),
  ).length;
  const toSearch = priorAccounts.filter((a) => !restCoverage.has(a.accountId));

  return {
    toSearch,
    scopedAccounts: scoped.length,
    skippedFresh: scoped.length - priorAccounts.length,
    skippedRestCovered,
    restAttempted,
  };
}
