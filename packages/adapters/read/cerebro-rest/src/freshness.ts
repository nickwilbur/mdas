// Freshness skip policy for cerebro-rest vs cerebro-glean.
//
// Both adapters historically stamped `lastFetchedFromSource.cerebro`, but only
// cerebro-rest populates Risk Category + narrative. If REST reused Glean's
// freshness stamp, every account looked "fresh" after a glean-only refresh and
// REST silently returned zero rows — the workbench then showed composite risk
// scores with "Cerebro narrative not synced".

import type { CanonicalAccount } from '@mdas/canonical';
import { isFreshEnoughToSkip } from '../../_shared/src/glean.js';

/** True when the account carries REST-grade Cerebro narrative fields. */
export function hasCerebroNarrative(account: CanonicalAccount): boolean {
  if (account.cerebroRiskCategory) return true;
  const analysis = account.cerebroRiskAnalysis?.trim();
  return !!analysis;
}

/** True when cerebro-rest can skip this account's REST call. */
export function shouldSkipCerebroRestFetch(account: CanonicalAccount): boolean {
  if (!hasCerebroNarrative(account)) return false;
  return isFreshEnoughToSkip(account.lastFetchedFromSource?.cerebro);
}
