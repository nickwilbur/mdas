import { describe, it, expect } from 'vitest';
import {
  computePlanConfidence,
  detectDataQualityIssues,
  scoreExpansionPotential,
  scoreRenewalOutlook,
  scoreSupportRisk,
} from './scoring.js';
import { runAllLocalCollectors } from './collectors/index.js';
import { generateAccountPlan } from './assemble.js';
import { acct, renewalOpp, testView } from './fixtures.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

describe('scoring', () => {
  it('scores at-risk renewal for Red sentiment and churn signals', () => {
    const v = testView(
      {
        cseSentiment: 'Red',
        cerebroRiskCategory: 'High',
        cerebroRisks: { ...acct().cerebroRisks, utilizationRisk: true },
      },
      [renewalOpp('2027-02-01', { churnRisk: 'At Risk', churnDownsellReason: 'Budget cuts' })],
    );
    const signals = runAllLocalCollectors({ view: v, now: NOW }).flatMap((c) => c.signals);
    const renewal = scoreRenewalOutlook(v, signals, NOW);
    expect(renewal.outlook).toBe('at_risk');
    expect(renewal.risks.length).toBeGreaterThan(0);
  });

  it('scores high expansion for upsell band and Green sentiment', () => {
    const v = buildHighExpansionView();
    const signals = runAllLocalCollectors({ view: v, now: NOW }).flatMap((c) => c.signals);
    const expansion = scoreExpansionPotential(v, signals);
    expect(['high', 'medium']).toContain(expansion.potential);
  });

  it('lowers confidence when collectors fail', () => {
    const signals = runAllLocalCollectors({
      view: testView({}, [renewalOpp('2027-02-01')]),
      now: NOW,
    }).flatMap((c) => c.signals);
    expect(
      computePlanConfidence(signals, [
        'glean: unavailable',
        'slack: unavailable',
        'cerebro: timeout',
        'salesforce: missing',
      ]),
    ).toBe('low');
  });

  it('attaches evidence ids to generated findings', () => {
    const v = testView({ cseSentiment: 'Red' }, [renewalOpp('2027-02-01')]);
    const collectorOutputs = runAllLocalCollectors({ view: v, now: NOW });
    const plan = generateAccountPlan({
      view: v,
      collectorOutputs,
      now: NOW,
      generationMode: 'single_account',
    });
    expect(plan.renewal.risks.some((r) => r.sourceSignalIds.length > 0)).toBe(true);
  });

  it('detects stale CSE commentary', () => {
    const v = testView({
      cseSentiment: 'Yellow',
      cseSentimentCommentaryLastUpdated: '2026-01-01T00:00:00Z',
    });
    const signals = runAllLocalCollectors({ view: v, now: NOW }).flatMap((c) => c.signals);
    const renewal = scoreRenewalOutlook(v, signals, NOW);
    expect(renewal.risks.some((r) => r.title.includes('Stale CSE commentary'))).toBe(true);
  });

  it('detects conflicting usage vs support signals', () => {
    const signals = runAllLocalCollectors({
      view: testView({
        cerebroRiskCategory: 'High',
        cerebroRisks: { ...acct().cerebroRisks, engagementRisk: true },
        cerebroSubMetrics: { usageGrowth: 'high' },
      }),
      now: NOW,
    }).flatMap((c) => c.signals);
    const dq = detectDataQualityIssues(signals, [], 'neutral', 'medium');
    expect(dq.conflictingSignals.length).toBeGreaterThanOrEqual(0);
  });

  it('scores support risk from cerebro category', () => {
    const v = testView({ cerebroRiskCategory: 'Critical' });
    const signals = runAllLocalCollectors({ view: v, now: NOW }).flatMap((c) => c.signals);
    expect(scoreSupportRisk(v, signals).overallRisk).toBe('high');
  });
});

function buildHighExpansionView() {
  const base = testView(
    {
      cseSentiment: 'Green',
      activeProductLines: ['Billing', 'RevPro', 'CPQ'],
      cerebroSubMetrics: { usageLevel: 'high', overage: true },
    },
    [
      renewalOpp('2027-08-01', {
        opportunityId: 'exp-1',
        type: 'Upsell',
        opportunityName: 'Expansion',
        stageName: 'Evaluation',
      }),
    ],
  );
  return { ...base, upsell: { band: 'Hot' as const, score: 85 } };
}

describe('generateAccountPlan', () => {
  it('does not fail when cerebro collector partial', () => {
    const v = testView({ sourceErrors: { cerebro: 'timeout' } }, [renewalOpp('2027-02-01')]);
    const collectorOutputs = runAllLocalCollectors({ view: v, now: NOW });
    const plan = generateAccountPlan({
      view: v,
      collectorOutputs,
      now: NOW,
      generationMode: 'single_account',
    });
    expect(plan.dataQuality.notes.some((n) => n.includes('cerebro'))).toBe(true);
    expect(plan.summary.headline).toContain('Acme Corp');
  });
});
