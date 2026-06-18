import type { AccountView, CerebroRisks } from '@mdas/canonical';

export interface CerebroSignalSummary {
  key: string;
  label: string;
  atRisk: boolean | null;
}

export interface CTAAccountHoverContext {
  accountId: string;
  accountName: string;
  overallSummary: string | null;
  cseSentiment: string | null;
  cerebroRiskCategory: string | null;
  cerebroSignals: CerebroSignalSummary[];
}

const SIGNAL_LABELS: Record<keyof CerebroRisks, string> = {
  utilizationRisk: 'Utilization',
  engagementRisk: 'Engagement',
  suiteRisk: 'Suite',
  shareRisk: 'Share',
  legacyTechRisk: 'Legacy Tech',
  expertiseRisk: 'Expertise',
  pricingRisk: 'Pricing',
};

function firstCommentarySentence(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const cleaned = text
    .replace(/^STATE AND RENEWAL RISK:\s*/i, '')
    .replace(/^ACTION PLAN:\s*/i, '')
    .trim();
  const sentence = cleaned.split(/\.\s/)[0]?.trim();
  if (!sentence || sentence.length < 12) return cleaned.slice(0, 220) || null;
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
}

export function buildAccountHoverContext(view: AccountView): CTAAccountHoverContext {
  const { account } = view;
  const overallSummary =
    account.cerebroRiskAnalysis?.trim() ||
    firstCommentarySentence(account.cseSentimentCommentary) ||
    view.risk.rationale?.trim() ||
    null;

  const cerebroSignals = (Object.keys(SIGNAL_LABELS) as (keyof CerebroRisks)[]).map(
    (key) => ({
      key,
      label: SIGNAL_LABELS[key],
      atRisk: account.cerebroRisks?.[key] ?? null,
    }),
  );

  return {
    accountId: account.accountId,
    accountName: account.accountName,
    overallSummary,
    cseSentiment: account.cseSentiment,
    cerebroRiskCategory: account.cerebroRiskCategory,
    cerebroSignals,
  };
}

export function buildAccountHoverContextMap(
  views: AccountView[],
): Record<string, CTAAccountHoverContext> {
  const map: Record<string, CTAAccountHoverContext> = {};
  for (const view of views) {
    const ctx = buildAccountHoverContext(view);
    map[view.account.accountId] = ctx;
    if (view.account.salesforceAccountId) {
      map[view.account.salesforceAccountId] = ctx;
    }
    map[view.account.accountName.toLowerCase()] = ctx;
  }
  return map;
}

export function lookupAccountHoverContext(
  map: Record<string, CTAAccountHoverContext>,
  cta: { salesforce_account_id: string | null; account_name: string },
): CTAAccountHoverContext | null {
  if (cta.salesforce_account_id && map[cta.salesforce_account_id]) {
    return map[cta.salesforce_account_id]!;
  }
  return map[cta.account_name.toLowerCase()] ?? null;
}
