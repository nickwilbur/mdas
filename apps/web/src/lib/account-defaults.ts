import type { CanonicalAccount, CanonicalOpportunity, AccountView, ChangeEvent } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';

/** Defaults partial SF / supplemental accounts need before scoring. */
export function withAccountDefaults(a: CanonicalAccount): CanonicalAccount {
  return {
    ...a,
    lastUpdated: a.lastUpdated ?? new Date().toISOString(),
    workshops: a.workshops ?? [],
    recentMeetings: a.recentMeetings ?? [],
    accountPlanLinks: a.accountPlanLinks ?? [],
    gainsightTasks: a.gainsightTasks ?? [],
    sourceLinks: a.sourceLinks ?? [],
    activeProductLines: a.activeProductLines ?? [],
    cerebroSubMetrics: a.cerebroSubMetrics ?? {},
    cerebroRisks:
      a.cerebroRisks ?? {
        utilizationRisk: null,
        engagementRisk: null,
        suiteRisk: null,
        shareRisk: null,
        legacyTechRisk: null,
        expertiseRisk: null,
        pricingRisk: null,
      },
    lastFetchedFromSource: a.lastFetchedFromSource ?? {},
  };
}

export function buildAccountViewWithDefaults(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
  opts: { changeEvents?: ChangeEvent[]; prevRiskCategory?: string | null } = {},
): AccountView {
  return buildAccountView(withAccountDefaults(account), opps, opts);
}
