// Unit tests for the composite Risk Score scaffold.
// Audit ref: F-05 in docs/audit/01_findings.md.
import { describe, expect, it } from 'vitest';
import type {
  CanonicalAccount,
  CanonicalOpportunity,
  ChangeEvent,
} from '@mdas/canonical';
import { computeRiskScore } from './risk-score.js';

const NOW = Date.parse('2026-04-28T18:00:00.000Z');
const DAY = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY).toISOString();
}
function daysAhead(n: number): string {
  return new Date(NOW + n * DAY).toISOString().slice(0, 10);
}

function mkAccount(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: 'A1',
    salesforceAccountId: 'SFID',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: null,
    assignedCSE: null,
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: null,
    cseSentimentCommentary: null,
    cseSentimentLastUpdated: null,
    cseSentimentCommentaryLastUpdated: null,
    cerebroRiskCategory: null,
    cerebroRiskAnalysis: null,
    cerebroRisks: {
      utilizationRisk: false,
      engagementRisk: false,
      suiteRisk: false,
      shareRisk: false,
      legacyTechRisk: false,
      expertiseRisk: false,
      pricingRisk: false,
    },
    cerebroSubMetrics: {},
    allTimeARR: 100_000,
    activeProductLines: [],
    engagementMinutes30d: null,
    engagementMinutes90d: null,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    sourceLinks: [],
    lastUpdated: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function mkOpp(overrides: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
  return {
    opportunityId: 'O1',
    opportunityName: 'A Renewal',
    accountId: 'A1',
    type: 'Renewal',
    stageName: 'Qualification',
    stageNum: 2,
    closeDate: daysAhead(180),
    closeQuarter: 'Q3',
    fiscalYear: 2027,
    acv: 100_000,
    availableToRenewUSD: 100_000,
    forecastMostLikely: 100_000,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: 'Medium',
    forecastHedgeUSD: 0,
    acvDelta: 0,
    knownChurnUSD: 0,
    productLine: null,
    flmNotes: null,
    slmNotes: null,
    scNextSteps: null,
    salesEngineer: null,
    fullChurnNotificationToOwnerDate: null,
    fullChurnFinalEmailSentDate: null,
    churnDownsellReason: null,
    sourceLinks: [],
    lastUpdated: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('computeRiskScore', () => {
  it('returns Low band with 0 score and low confidence on a blank account', () => {
    const out = computeRiskScore({
      account: mkAccount(),
      opportunities: [],
      now: NOW,
    });
    expect(out.score).toBe(0);
    expect(out.band).toBe('Low');
    expect(out.confidence).toBe('low');
    expect(out.signals).toHaveLength(0);
  });

  it('Cerebro Risk Category Critical alone reaches Medium band with high confidence', () => {
    const out = computeRiskScore({
      account: mkAccount({ cerebroRiskCategory: 'Critical' }),
      opportunities: [],
      now: NOW,
    });
    expect(out.confidence).toBe('high');
    expect(out.score).toBe(25);
    expect(out.band).toBe('Medium');
    expect(out.signals.map((s) => s.label)).toContain('Cerebro Risk Category: Critical');
  });

  it('compounds Critical Cerebro + 5 risk flags + Red sentiment + stale commentary into Critical band', () => {
    const out = computeRiskScore({
      account: mkAccount({
        cerebroRiskCategory: 'Critical',
        cerebroRisks: {
          utilizationRisk: true,
          engagementRisk: true,
          suiteRisk: true,
          shareRisk: true,
          legacyTechRisk: true,
          expertiseRisk: false,
          pricingRisk: false,
        },
        cseSentiment: 'Red',
        cseSentimentCommentaryLastUpdated: daysAgo(35),
      }),
      opportunities: [],
      now: NOW,
    });
    // 25 (Cerebro Critical) + 10 (5*2 capped at 14) + 12 (Red) + ≥2 (stale)
    expect(out.score).toBeGreaterThanOrEqual(49);
    expect(['High', 'Critical']).toContain(out.band);
    expect(out.confidence).toBe('high');
  });

  it('caps the score at 100', () => {
    const churnOpp = mkOpp({ fullChurnNotificationToOwnerDate: '2026-04-23' });
    const out = computeRiskScore({
      account: mkAccount({
        cerebroRiskCategory: 'Critical',
        cseSentiment: 'Confirmed Churn',
        cerebroRisks: {
          utilizationRisk: true,
          engagementRisk: true,
          suiteRisk: true,
          shareRisk: true,
          legacyTechRisk: true,
          expertiseRisk: true,
          pricingRisk: true,
        },
        cseSentimentCommentaryLastUpdated: daysAgo(120),
        engagementMinutes30d: 0,
        engagementMinutes90d: 600,
      }),
      opportunities: [churnOpp],
      now: NOW,
    });
    expect(out.score).toBe(100);
    expect(out.band).toBe('Critical');
  });

  it('rewards an improving WoW sentiment movement (Red → Yellow) with a negative contribution', () => {
    const event: ChangeEvent = {
      accountId: 'A1',
      field: 'cseSentiment',
      oldValue: 'Red',
      newValue: 'Yellow',
      occurredBetween: ['p', 'c'],
      category: 'sentiment',
      label: 'Sentiment Red → Yellow',
    };
    const baseline = computeRiskScore({
      account: mkAccount({ cseSentiment: 'Yellow' }),
      opportunities: [],
      now: NOW,
    });
    const improved = computeRiskScore({
      account: mkAccount({ cseSentiment: 'Yellow' }),
      opportunities: [],
      changeEvents: [event],
      now: NOW,
    });
    expect(improved.score).toBeLessThan(baseline.score);
    expect(improved.signals.some((s) => s.points < 0)).toBe(true);
  });

  it('recognizes renewal proximity inside 90 days', () => {
    const opp = mkOpp({ closeDate: daysAhead(45) });
    const out = computeRiskScore({
      account: mkAccount(),
      opportunities: [opp],
      now: NOW,
    });
    const labels = out.signals.map((s) => s.label);
    expect(labels.some((l) => l.startsWith('Renewal in'))).toBe(true);
  });

  it('emits churnNotice signal when a renewal opp has a churn notice date', () => {
    const opp = mkOpp({
      type: 'Renewal',
      fullChurnNotificationToOwnerDate: '2026-04-23',
    });
    const out = computeRiskScore({
      account: mkAccount(),
      opportunities: [opp],
      now: NOW,
    });
    expect(out.signals.some((s) => s.label === 'Churn notice submitted')).toBe(true);
  });

  it('flags low confidence when Cerebro Risk Category is absent', () => {
    const out = computeRiskScore({
      account: mkAccount({
        cerebroRiskCategory: null,
        cseSentiment: 'Red',
      }),
      opportunities: [],
      now: NOW,
    });
    expect(out.confidence).toBe('low');
    expect(out.signals.some((s) => s.label === 'CSE Sentiment: Red')).toBe(true);
  });
});
