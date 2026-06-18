import { describe, expect, it } from 'vitest';
import type { AccountView } from '@mdas/canonical';
import {
  buildAccountHoverContext,
  lookupAccountHoverContext,
} from './cta-account-context';

function minimalView(overrides: Partial<AccountView['account']> = {}): AccountView {
  return {
    account: {
      accountId: 'acc-1',
      accountName: 'Acme Corp',
      salesforceAccountId: '001ABC',
      franchise: 'Expand 3',
      cerebroRiskAnalysis: 'High utilization risk with declining engagement.',
      cseSentiment: 'Yellow',
      cseSentimentCommentary: 'STATE AND RENEWAL RISK: Renewal at risk. ACTION PLAN: Schedule QBR.',
      cerebroRisks: {
        utilizationRisk: true,
        engagementRisk: false,
        suiteRisk: null,
        shareRisk: false,
        legacyTechRisk: false,
        expertiseRisk: true,
        pricingRisk: false,
      },
      cerebroSubMetrics: {},
      ...overrides,
    },
    risk: { level: 'Red', source: 'cerebro', rationale: 'Fallback rationale' },
    opportunities: [],
    metrics: {},
  } as unknown as AccountView;
}

describe('buildAccountHoverContext', () => {
  it('prefers cerebro risk analysis for overall summary', () => {
    const ctx = buildAccountHoverContext(minimalView());
    expect(ctx.overallSummary).toBe('High utilization risk with declining engagement.');
    expect(ctx.cerebroSignals).toHaveLength(7);
    expect(ctx.cerebroSignals.find((s) => s.key === 'utilizationRisk')?.atRisk).toBe(true);
    expect(ctx.cseSentiment).toBe('Yellow');
  });

  it('looks up by salesforce id or account name', () => {
    const ctx = buildAccountHoverContext(minimalView());
    const map = { '001ABC': ctx, 'acme corp': ctx };
    expect(
      lookupAccountHoverContext(map, {
        salesforce_account_id: '001ABC',
        account_name: 'Other',
      }),
    ).toBe(ctx);
    expect(
      lookupAccountHoverContext(map, {
        salesforce_account_id: null,
        account_name: 'Acme Corp',
      }),
    ).toBe(ctx);
  });
});
