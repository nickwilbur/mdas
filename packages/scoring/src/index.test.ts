import { describe, expect, it } from 'vitest';
import {
  bucketAccount,
  buildAccountView,
  diffAccount,
  evaluateHygiene,
  getRiskIdentifier,
  rankAccountViews,
  scoreUpsell,
} from './index';
import type { CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';

const baseAccount: CanonicalAccount = {
  accountId: 'A1',
  salesforceAccountId: '0010000000000001',
  accountName: 'Acme',
  zuoraTenantId: 'tenant-1',
  accountOwner: { id: 'U1', name: 'Owner' },
  assignedCSE: { id: 'U2', name: 'CSE One' },
  csCoverage: 'CSE',
  franchise: 'Expand 3',
  cseSentiment: 'Green',
  cseSentimentCommentary: 'STATE AND RENEWAL RISK: ok\nACTION PLAN: continue.',
  cseSentimentLastUpdated: new Date().toISOString(),
  cseSentimentCommentaryLastUpdated: new Date().toISOString(),
  cerebroRiskCategory: 'Low',
  cerebroRiskAnalysis: 'No major risks.',
  cerebroRisks: {
    utilizationRisk: false,
    engagementRisk: false,
    suiteRisk: false,
    shareRisk: false,
    legacyTechRisk: false,
    expertiseRisk: false,
    pricingRisk: false,
  },
  cerebroSubMetrics: { 'Executive Meeting Count (90d)': 3 },
  allTimeARR: 500_000,
  activeProductLines: ['Zuora Billing'],
  engagementMinutes30d: 120,
  engagementMinutes90d: 400,
  isConfirmedChurn: false,
  churnReason: null,
  churnReasonSummary: null,
  churnDate: null,
  gainsightTasks: [],
  workshops: [
    {
      id: 'W1',
      engagementType: 'Quarterly Workshop',
      status: 'Completed',
      workshopDate: new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
    },
  ],
  recentMeetings: [
    {
      source: 'calendar',
      title: 'QBR',
      startTime: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
      attendees: ['nick@zuora.com'],
      summary: null,
      url: null,
    },
  ],
  accountPlanLinks: [],
  sourceLinks: [],
  lastUpdated: new Date().toISOString(),
};

describe('getRiskIdentifier', () => {
  it('passes through Cerebro Risk Category', () => {
    const r = getRiskIdentifier({ ...baseAccount, cerebroRiskCategory: 'High', cerebroRiskAnalysis: 'narrative' });
    expect(r.level).toBe('High');
    expect(r.source).toBe('cerebro');
    expect(r.rationale).toBe('narrative');
  });

  it('falls back to Critical when 4+ risks True', () => {
    const r = getRiskIdentifier({
      ...baseAccount,
      cerebroRiskCategory: null,
      cerebroRisks: {
        utilizationRisk: true,
        engagementRisk: true,
        suiteRisk: true,
        shareRisk: true,
        legacyTechRisk: false,
        expertiseRisk: false,
        pricingRisk: false,
      },
    });
    expect(r.level).toBe('Critical');
    expect(r.source).toBe('fallback');
  });

  it('falls back to High when sentiment Red, no Cerebro', () => {
    const r = getRiskIdentifier({
      ...baseAccount,
      cerebroRiskCategory: null,
      cseSentiment: 'Red',
    });
    expect(r.level).toBe('High');
    expect(r.source).toBe('fallback');
  });
});

describe('bucketAccount', () => {
  it('confirmed churn beats risk', () => {
    expect(
      bucketAccount({ ...baseAccount, cseSentiment: 'Confirmed Churn' }, []),
    ).toBe('Confirmed Churn');
  });
  it('risk High becomes Saveable Risk', () => {
    expect(
      bucketAccount({ ...baseAccount, cerebroRiskCategory: 'High' }, []),
    ).toBe('Saveable Risk');
  });
  it('Low risk stays Healthy', () => {
    expect(bucketAccount(baseAccount, [])).toBe('Healthy');
  });
});

describe('scoreUpsell', () => {
  it('rewards open upsell + workshop + whitespace', () => {
    const opp: CanonicalOpportunity = {
      opportunityId: 'O1',
      opportunityName: 'Acme Upsell',
      accountId: 'A1',
      type: 'Upsell',
      stageName: 'Stage 3 - Validate',
      stageNum: 3,
      closeDate: new Date(Date.now() + 60 * 86400 * 1000).toISOString().slice(0, 10),
      closeQuarter: 'Q3',
      fiscalYear: 2026,
      acv: 100_000,
      availableToRenewUSD: 0,
      forecastMostLikely: 80_000,
      forecastMostLikelyOverride: null,
      mostLikelyConfidence: 'Medium',
      forecastHedgeUSD: 50_000,
      acvDelta: 80_000,
      knownChurnUSD: 0,
      productLine: 'Zephr',
      flmNotes: 'Notes',
      slmNotes: null,
      scNextSteps: 'Next.',
      salesEngineer: { id: 'U2', name: 'CSE One' },
      fullChurnNotificationToOwnerDate: null,
      fullChurnFinalEmailSentDate: null,
      churnDownsellReason: null,
      sourceLinks: [],
      lastUpdated: new Date().toISOString(),
    };
    const r = scoreUpsell(baseAccount, [opp]);
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.signals.find((s) => s.label.startsWith('Open Upsell'))).toBeTruthy();
    expect(r.signals.find((s) => /Whitespace/.test(s.label))).toBeTruthy();
  });
});

describe('evaluateHygiene', () => {
  it('flags stale red sentiment commentary', () => {
    const old = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const v = evaluateHygiene(
      {
        ...baseAccount,
        cseSentiment: 'Red',
        cseSentimentCommentary: 'STATE AND RENEWAL RISK: bad. ACTION PLAN: things.',
        cseSentimentCommentaryLastUpdated: old,
      },
      [],
    );
    expect(v.find((x) => x.rule === 'stale_sentiment_commentary')).toBeTruthy();
  });

  it('flags missing FLM notes on yellow', () => {
    const opp: CanonicalOpportunity = {
      opportunityId: 'O1',
      opportunityName: 'Renewal',
      accountId: 'A1',
      type: 'Renewal',
      stageName: 'Stage 1',
      stageNum: 1,
      closeDate: '2026-06-30',
      closeQuarter: 'Q2',
      fiscalYear: 2026,
      acv: 100_000,
      availableToRenewUSD: 100_000,
      forecastMostLikely: null,
      forecastMostLikelyOverride: null,
      mostLikelyConfidence: 'Medium',
      forecastHedgeUSD: null,
      acvDelta: 0,
      knownChurnUSD: 0,
      productLine: 'Zuora Billing',
      flmNotes: '',
      slmNotes: null,
      scNextSteps: 'something',
      salesEngineer: null,
      fullChurnNotificationToOwnerDate: null,
      fullChurnFinalEmailSentDate: null,
      churnDownsellReason: null,
      sourceLinks: [],
      lastUpdated: new Date().toISOString(),
    };
    const v = evaluateHygiene(
      { ...baseAccount, cseSentiment: 'Yellow' },
      [opp],
    );
    expect(v.find((x) => x.rule === 'missing_flm_notes_on_risk')).toBeTruthy();
  });
});

describe('rankAccountViews', () => {
  it('orders Saveable Risk before Healthy', () => {
    const a = buildAccountView({ ...baseAccount, accountId: 'A1', cerebroRiskCategory: 'High' }, []);
    const b = buildAccountView({ ...baseAccount, accountId: 'A2' }, []);
    const sorted = rankAccountViews([b, a]);
    expect(sorted[0]!.account.accountId).toBe('A1');
  });
});

describe('diffAccount', () => {
  it('detects sentiment change', () => {
    const prev = { ...baseAccount, cseSentiment: 'Green' as const };
    const curr = { ...baseAccount, cseSentiment: 'Red' as const };
    const events = diffAccount(prev, curr, 'r1', 'r2');
    expect(events.find((e) => e.field === 'cseSentiment')).toBeTruthy();
  });
});
