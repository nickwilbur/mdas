import type { AccountView, CanonicalOpportunity } from '@mdas/canonical';
import { EXPAND3_FRANCHISE, isActiveExpand3Account, isConfirmedFullChurnRisk } from '@mdas/canonical';
import { buildAccountView } from '@mdas/scoring';
import { fiscalYearFromDate } from './fiscal.js';

export { EXPAND3_FRANCHISE };

const DAY = 86_400_000;

const CLOSED_STAGE = /^(closed|won|lost|dead|churn)/i;

/** True when the account has already churned — excluded from CTA generation. */
export function isChurnedAccount(view: AccountView): boolean {
  return !isActiveExpand3Account(view.account, view.opportunities);
}

function isOpenRenewalOpp(opp: CanonicalOpportunity): boolean {
  if (!/renewal/i.test(opp.type)) return false;
  if (!opp.closeDate) return false;
  if (CLOSED_STAGE.test(opp.stageName ?? '')) return false;
  if (isConfirmedFullChurnRisk(opp.churnRisk)) return false;
  if (opp.fullChurnNotificationToOwnerDate || opp.fullChurnFinalEmailSentDate) return false;
  return true;
}

/** Next open renewal opp with a future close date. */
export function nextFutureRenewalOpp(
  view: AccountView,
  now: number = Date.now(),
): CanonicalOpportunity | null {
  const today = new Date(now).toISOString().slice(0, 10);
  const candidates = view.opportunities
    .filter(isOpenRenewalOpp)
    .filter((o) => o.closeDate >= today)
    .sort((a, b) => Date.parse(a.closeDate) - Date.parse(b.closeDate));
  return candidates[0] ?? null;
}

/** Open renewal opp in one of the given Zuora fiscal years (e.g. 2027 = FY27). */
export function hasOpenRenewalInFiscalYears(
  view: AccountView,
  fiscalYears: number[],
  now: number = Date.now(),
): boolean {
  if (fiscalYears.length === 0) return true;
  const today = new Date(now).toISOString().slice(0, 10);
  const allowed = new Set(fiscalYears);
  return view.opportunities.some((o) => {
    if (!isOpenRenewalOpp(o)) return false;
    if (o.closeDate < today) return false;
    const fy = fiscalYearFromDate(o.closeDate);
    return fy != null && allowed.has(fy);
  });
}

/**
 * Re-scope a view to Expand 3 renewal opps and recompute renewal timing
 * from the next future opp only (avoids past renewal dates in CTAs).
 */
export function normalizeExpand3View(
  view: AccountView,
  now: number = Date.now(),
): AccountView {
  const renewalOpps = view.opportunities.filter(isOpenRenewalOpp);
  const futureOpp = nextFutureRenewalOpp(view, now);
  const scopedOpps = futureOpp ? [futureOpp] : renewalOpps;

  const rebuilt = buildAccountView(view.account, scopedOpps.length ? scopedOpps : []);
  return {
    ...rebuilt,
    riskScore: view.riskScore,
    changeEvents: view.changeEvents,
  };
}

export interface Expand3ScopeOptions {
  /** Optional SFDC report rows — when present, intersect by id/name. */
  reportAccountIds?: Set<string>;
  reportAccountNames?: Set<string>;
  /** When set, only accounts with an open renewal in these FYs (e.g. 2027 = FY27). */
  renewalFiscalYears?: number[];
  now?: number;
}

/**
 * Keep only Expand 3, non-churned accounts (and optional report universe).
 */
export function filterExpand3Views(
  views: AccountView[],
  options: Expand3ScopeOptions = {},
): AccountView[] {
  const { now = Date.now() } = options;
  const ids = options.reportAccountIds;
  const names = options.reportAccountNames;
  const useReport = ids && names && (ids.size > 0 || names.size > 0);

  return views
    .filter((v) => isActiveExpand3Account(v.account, v.opportunities))
    .filter((v) => {
      if (!useReport) return true;
      const id = v.account.salesforceAccountId || v.account.accountId;
      return (
        ids!.has(id) ||
        names!.has(v.account.accountName.toLowerCase())
      );
    })
    .filter((v) => {
      const fys = options.renewalFiscalYears;
      if (!fys?.length) return true;
      return hasOpenRenewalInFiscalYears(v, fys, now);
    })
    .map((v) => normalizeExpand3View(v, now));
}
