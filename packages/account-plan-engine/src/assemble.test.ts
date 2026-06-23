import { describe, expect, it } from 'vitest';
import { generateAccountPlan } from './assemble.js';
import { runAllLocalCollectors } from './collectors/index.js';
import { renewalOpp, testView } from './fixtures.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

describe('assembleAccountPlan actions', () => {
  it('adds high-priority Renewals action when churn or downsell risks are present', () => {
    const view = testView(
      { cseSentiment: 'Red' },
      [renewalOpp('2027-02-01', { churnDownsellReason: 'Budget freeze' })],
    );
    const collectorOutputs = runAllLocalCollectors({ view, now: NOW });
    const plan = generateAccountPlan({
      view,
      collectorOutputs,
      now: NOW,
      generationMode: 'single_account',
    });

    const renewalsAction = plan.actionPlan.find((a) => a.ownerRole === 'Renewals');
    expect(renewalsAction?.priority).toBe('high');
    expect(renewalsAction?.action).toMatch(/save plan/i);
  });

  it('adds medium-priority CSE action for stale commentary', () => {
    const view = testView({
      cseSentiment: 'Yellow',
      cseSentimentCommentaryLastUpdated: '2026-01-01T00:00:00Z',
    });
    const collectorOutputs = runAllLocalCollectors({ view, now: NOW });
    const plan = generateAccountPlan({
      view,
      collectorOutputs,
      now: NOW,
      generationMode: 'single_account',
    });

    const staleAction = plan.actionPlan.find((a) =>
      /refresh CSE account commentary/i.test(a.action),
    );
    expect(staleAction?.priority).toBe('medium');
    expect(staleAction?.ownerRole).toBe('CSE');
  });

  it('caps action plan at six items', () => {
    const view = testView(
      {
        cseSentiment: 'Red',
        cerebroRiskCategory: 'Critical',
        cerebroRisks: {
          utilizationRisk: true,
          engagementRisk: true,
          suiteRisk: null,
          shareRisk: null,
          legacyTechRisk: null,
          expertiseRisk: null,
          pricingRisk: null,
        },
        cseSentimentCommentaryLastUpdated: '2026-01-01T00:00:00Z',
        activeProductLines: ['Billing', 'RevPro'],
        cerebroSubMetrics: { usageGrowth: 'high' },
      },
      [
        renewalOpp('2027-02-01', {
          churnRisk: 'At Risk',
          churnDownsellReason: 'Competitive loss',
        }),
        renewalOpp('2027-08-01', {
          opportunityId: 'exp-1',
          type: 'Upsell',
          opportunityName: 'Expansion',
        }),
      ],
    );
    const collectorOutputs = runAllLocalCollectors({ view, now: NOW });
    const plan = generateAccountPlan({
      view,
      collectorOutputs,
      now: NOW,
      generationMode: 'single_account',
    });

    expect(plan.actionPlan.length).toBeLessThanOrEqual(6);
  });
});
