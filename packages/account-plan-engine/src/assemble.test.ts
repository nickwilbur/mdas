import { describe, expect, it } from 'vitest';
import { generateAccountPlan } from './assemble.js';
import { runAllLocalCollectors } from './collectors/index.js';
import { acct, renewalOpp, testView } from './fixtures.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

function planFor(overrides: Parameters<typeof testView>[0] = {}, opps = [renewalOpp('2027-04-01')]) {
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
      cseSentimentCommentary: '<p>Budget <strong>pressure</strong>&nbsp;on renewal.</p>',
    });
    expect(plan.customerHealth.cseCommentary).toBe('Budget pressure on renewal.');
    expect(plan.customerHealth.cseCommentary).not.toContain('<');
  });

  it('adds engagement-gap finding when last activity exceeds 21 days', () => {
    const plan = planFor({
      cseSentimentCommentaryLastUpdated: '2026-04-01T00:00:00Z',
      cseSentimentLastUpdated: '2026-04-01T00:00:00Z',
    });
    const gap = plan.relationshipAndEngagement.findings.find((f) => f.title === 'Engagement gap');
    expect(gap?.detail).toMatch(/days ago/);
    expect(plan.relationshipAndEngagement.assessment).toContain('limited');
  });

  it('flags missing Slack channel mapping as an open question', () => {
    const plan = planFor({ salesforceSlackChannelUrl: null });
    expect(plan.relationshipAndEngagement.openQuestions).toContain(
      'Internal Slack channel not mapped.',
    );
  });

  it('recommends renewals alignment when churn or downsell signals are present', () => {
    const plan = planFor(
      { cseSentiment: 'Yellow' },
      [
        renewalOpp('2027-04-01', {
          churnRisk: 'At Risk',
          churnDownsellReason: 'Budget cuts',
        }),
      ],
    );
    const renewalsAction = plan.actionPlan.find((a) => a.ownerRole === 'Renewals');
    expect(renewalsAction?.action).toMatch(/save plan/i);
    expect(renewalsAction?.priority).toBe('high');
  });

  it('falls back to maintain-cadence action when no risk signals fire', () => {
    const plan = planFor({
      cseSentiment: 'Yellow',
      cerebroRiskCategory: 'Low',
      cseSentimentCommentaryLastUpdated: '2026-06-10T00:00:00Z',
      cseSentimentLastUpdated: '2026-06-10T00:00:00Z',
      recentMeetings: [
        {
          source: 'calendar',
          title: 'QBR',
          startTime: '2026-06-10T00:00:00Z',
          attendees: [],
          summary: 'Healthy engagement.',
          url: 'https://calendar.google.com/event/1',
        },
      ],
    });
    expect(plan.renewal.risks).toHaveLength(0);
    expect(plan.expansion.hypotheses).toHaveLength(0);
    expect(plan.supportAndRisk.findings).toHaveLength(0);
    expect(plan.actionPlan.some((a) => a.action.includes('Maintain cadence'))).toBe(true);
    expect(plan.actionPlan.length).toBeLessThanOrEqual(6);
  });

  it('surfaces support review action when Cerebro risk flags are active', () => {
    const plan = planFor({
      cerebroRiskCategory: 'Critical',
      cerebroRisks: { ...acct().cerebroRisks, engagementRisk: true },
    });
    const supportAction = plan.actionPlan.find((a) => a.ownerRole === 'Support');
    expect(supportAction?.action).toMatch(/Cerebro risks/i);
    expect(supportAction?.priority).toBe('high');
  });
});
