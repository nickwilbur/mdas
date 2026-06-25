import { describe, it, expect } from 'vitest';
import { generateAccountPlan } from './assemble.js';
import { runAllLocalCollectors } from './collectors/index.js';
import { acct, renewalOpp, testView } from './fixtures.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

function planFor(
  overrides: Parameters<typeof testView>[0] = {},
  opps: Parameters<typeof testView>[1] = [renewalOpp('2027-02-01')],
) {
  const view = testView(overrides, opps);
  const collectorOutputs = runAllLocalCollectors({ view, now: NOW });
  return generateAccountPlan({
    view,
    collectorOutputs,
    now: NOW,
    generationMode: 'single_account',
  });
}

describe('generateAccountPlan assembly', () => {
  it('strips HTML from CSE commentary in customer health', () => {
    const plan = planFor({
      cseSentimentCommentary: '<p>Stable &amp; growing</p>',
    });
    expect(plan.customerHealth.cseCommentary).toBe('Stable & growing');
  });

  it('truncates long CSE commentary to 400 characters', () => {
    const longText = 'x'.repeat(500);
    const plan = planFor({ cseSentimentCommentary: longText });
    expect(plan.customerHealth.cseCommentary).toHaveLength(400);
    expect(plan.customerHealth.cseCommentary).toBe(longText.slice(0, 400));
  });

  it('adds churn/downsell coordination action when renewal risks include churn signals', () => {
    const plan = planFor(
      { cseSentiment: 'Red' },
      [
        renewalOpp('2027-02-01', {
          churnRisk: 'At Risk',
          churnDownsellReason: 'Budget cuts',
        }),
      ],
    );
    expect(
      plan.actionPlan.some((a) =>
        a.action.includes('Align AE, CSE, and Renewals on save plan'),
      ),
    ).toBe(true);
  });

  it('adds default maintain-cadence action when no risk signals fire', () => {
    const plan = planFor({
      cseSentiment: 'Yellow',
      cerebroRiskCategory: 'Low',
      activeProductLines: ['Billing'],
      salesforceSlackChannelUrl: 'https://slack.example/channel',
      lastUpdated: new Date(NOW).toISOString(),
      cseSentimentCommentaryLastUpdated: new Date(NOW).toISOString(),
    });
    expect(plan.renewal.risks).toHaveLength(0);
    expect(plan.supportAndRisk.findings).toHaveLength(0);
    expect(plan.expansion.hypotheses).toHaveLength(0);
    expect(plan.actionPlan).toEqual([
      expect.objectContaining({
        action: 'Maintain cadence and monitor renewal timeline',
        ownerRole: 'CSE',
        priority: 'low',
      }),
    ]);
  });

  it('recommends expansion discovery for Green accounts with positive signals', () => {
    const plan = planFor({
      cseSentiment: 'Green',
      cerebroRiskCategory: 'Low',
    });
    expect(
      plan.actionPlan.some((a) =>
        a.action.includes('Validate expansion hypothesis'),
      ),
    ).toBe(true);
  });

  it('flags missing Slack channel in relationship open questions', () => {
    const plan = planFor({ salesforceSlackChannelUrl: null });
    expect(plan.relationshipAndEngagement.openQuestions).toContain(
      'Internal Slack channel not mapped.',
    );
  });

  it('adds engagement gap finding when last activity exceeds 21 days', () => {
    const stale = new Date(NOW - 30 * 86_400_000).toISOString();
    const plan = planFor({
      lastUpdated: stale,
      cseSentimentLastUpdated: stale,
      cseSentimentCommentaryLastUpdated: stale,
    });
    expect(
      plan.relationshipAndEngagement.findings.some((f) =>
        f.title.includes('Engagement gap'),
      ),
    ).toBe(true);
  });

  it('caps action plan at six items even with many risk signals', () => {
    const plan = planFor(
      {
        cseSentiment: 'Red',
        cerebroRiskCategory: 'Critical',
        cerebroRisks: {
          ...acct().cerebroRisks,
          utilizationRisk: true,
          engagementRisk: true,
        },
        cseSentimentCommentaryLastUpdated: '2026-01-01T00:00:00Z',
      },
      [
        renewalOpp('2027-02-01', {
          churnRisk: 'At Risk',
          churnDownsellReason: 'Competitive threat',
        }),
      ],
    );
    expect(plan.actionPlan.length).toBeLessThanOrEqual(6);
  });

  it('includes renewal opportunity fields on the renewal block', () => {
    const plan = planFor(
      {},
      [
        renewalOpp('2027-03-15', {
          stageName: 'Negotiation',
          closeQuarter: 'Q1 FY27',
          availableToRenewUSD: 120_000,
          acv: 110_000,
          acvDelta: -10_000,
          forecastMostLikely: 100_000,
        }),
      ],
    );
    expect(plan.renewal.renewalDate).toBe('2027-03-15');
    expect(plan.renewal.fiscalPeriod).toBe('Q1 FY27');
    expect(plan.renewal.stage).toBe('Negotiation');
    expect(plan.renewal.availableToRenew).toBe(120_000);
    expect(plan.renewal.currentAcv).toBe(110_000);
    expect(plan.renewal.acvDelta).toBe(-10_000);
    expect(plan.renewal.forecastMostLikely).toBe(100_000);
  });
});
