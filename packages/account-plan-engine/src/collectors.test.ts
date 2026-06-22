import { describe, it, expect } from 'vitest';
import {
  collectCerebroSupportSignals,
  collectCseSentimentSignals,
  collectGleanSignals,
  collectSalesforceSignals,
  collectSlackSignals,
  runAllLocalCollectors,
} from './collectors/index.js';
import { renewalOpp, testView } from './fixtures.js';

const NOW = Date.parse('2026-06-16T12:00:00Z');

describe('collectors', () => {
  it('normalizes Salesforce renewal signals', () => {
    const v = testView({}, [renewalOpp('2027-04-01')]);
    const out = collectSalesforceSignals({ view: v, now: NOW });
    expect(out.run.status).toBe('success');
    expect(out.signals.some((s) => s.id === 'sf:renewal_close_date')).toBe(true);
    expect(out.signals.some((s) => s.label === 'Franchise' && s.value === 'Expand 3')).toBe(true);
  });

  it('marks missing CSE data as partial', () => {
    const v = testView({ cseSentiment: null, cseSentimentCommentary: null });
    const out = collectCseSentimentSignals({ view: v, now: NOW });
    expect(out.run.status).toBe('partial');
  });

  it('records cerebro support failure without throwing', () => {
    const v = testView({ cerebroRiskCategory: null, sourceErrors: { cerebro: 'timeout' } });
    const out = collectCerebroSupportSignals({ view: v, now: NOW });
    expect(['failed', 'partial']).toContain(out.run.status);
    expect(out.run.errorCode).toBe('cerebro_error');
  });

  it('skips glean when no links or live context', () => {
    const v = testView({});
    const out = collectGleanSignals({ view: v, now: NOW, gleanContext: null });
    expect(out.run.status).toBe('skipped');
  });

  it('collects slack channel from Salesforce URL', () => {
    const v = testView({ salesforceSlackChannelUrl: 'https://slack.example/archives/C1' });
    const out = collectSlackSignals({ view: v, now: NOW });
    expect(out.signals.some((s) => s.id === 'slack:channel_url')).toBe(true);
  });

  it('continues when one collector would fail — runAllLocalCollectors returns all runs', () => {
    const v = testView({ sourceErrors: { cerebro: 'timeout' } }, [renewalOpp('2027-01-01')]);
    const outputs = runAllLocalCollectors({ view: v, now: NOW });
    expect(outputs).toHaveLength(6);
    expect(outputs.some((o) => o.run.collector === 'salesforce')).toBe(true);
  });
});
