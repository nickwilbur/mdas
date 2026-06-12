import { describe, expect, it } from 'vitest';
import { sanitizeMlMismatchContext } from './sanitize-forecast-context';
import {
  buildMlOverrideMismatchPrompt,
  parseMlOverrideMismatchEnrichment,
} from './forecast-ml-override-mismatch-core';
import type { MlOverrideMismatchContext } from '@mdas/forecast-generator';

const SAMPLE_CTX: MlOverrideMismatchContext = {
  opportunityId: 'O1',
  accountId: 'A1',
  accountName: 'Luminary Media',
  opportunityName: 'Luminary Media Billing 10-26',
  closeDate: '2026-10-17',
  mlOverrideUSD: -50_000,
  bestCaseUSD: 10_000,
  gapUSD: -60_000,
  forecastMostLikelyUSD: -50_000,
  forecastCategory: 'Targeted Upside',
  cerebroRiskCategory: 'High',
  cseSentiment: 'Red',
  accountOwnerName: 'Ethan Wookey',
  assignedCseName: 'Digital First',
  productLine: 'Zuora Billing',
};

describe('buildMlOverrideMismatchPrompt', () => {
  it('embeds char limits without throwing (regression: MAX_HEADLINE_CHARS)', () => {
    const prompt = buildMlOverrideMismatchPrompt(
      SAMPLE_CTX,
      '2026-05-29',
      'FY27 Q3',
    );
    expect(prompt).toContain('≤120 chars');
    expect(prompt).toContain('≤520 chars');
    expect(prompt).toContain('Luminary Media');
  });
});

describe('sanitizeMlMismatchContext', () => {
  it('collapses newlines so account names cannot orphan outside the section', () => {
    expect(
      sanitizeMlMismatchContext(
        'Gainsight records low engagement.\n\nPipedrive procurement pressure noted in notes.',
      ),
    ).toBe(
      'Gainsight records low engagement. Pipedrive procurement pressure noted in notes.',
    );
  });

  it('strips hedging and first-person discovery phrasing', () => {
    expect(
      sanitizeMlMismatchContext(
        'I found that Kustomer likely appears to be stalling on renewal scope.',
      ),
    ).toBe('Kustomer is stalling on renewal scope.');
  });
});

describe('parseMlOverrideMismatchEnrichment', () => {
  it('parses headline, commentary, and customerContext from JSON', () => {
    const parsed = parseMlOverrideMismatchEnrichment(
      JSON.stringify({
        headline: 'Perch is a product fit problem',
        commentary: 'The AE is more optimistic than the CSE override.',
        customerContext:
          'The customer wants a hybrid payments path and does not see Zuora as the full answer for Stripe Connect splits.',
      }),
    );
    expect(parsed).toMatchObject({
      headline: 'Perch is a product fit problem',
      commentary: 'The AE is more optimistic than the CSE override.',
    });
  });

  it('returns null for NONE', () => {
    expect(parseMlOverrideMismatchEnrichment('NONE')).toBeNull();
  });

  it('parses JSON inside markdown fences', () => {
    const parsed = parseMlOverrideMismatchEnrichment(
      '```json\n{"headline":"Omnitracs is a fit / performance problem","commentary":"","customerContext":"The customer will not renew unless deployment confidence returns."}\n```',
    );
    expect(parsed?.headline).toBe('Omnitracs is a fit / performance problem');
  });

  it('falls back to prose when Glean returns narrative instead of JSON', () => {
    const parsed = parseMlOverrideMismatchEnrichment(
      'Headline: Luminary is an engagement and sentiment problem\n\nCustomer context: The account is weak on both engagement and sentiment. The customer was unhappy with the last renewal conversation and metrics are red.',
    );
    expect(parsed?.headline).toContain('engagement');
    expect(parsed?.customerContext).toContain('weak on both engagement');
  });

  it('falls back to plain prose paragraph', () => {
    const parsed = parseMlOverrideMismatchEnrichment(
      'Luminary is an engagement and sentiment problem. The account is weak on both engagement and sentiment.',
    );
    expect(parsed?.headline).toContain('Luminary');
    expect(parsed?.customerContext).toContain('weak on both engagement');
  });

  it('extracts fields from truncated JSON instead of leaking raw JSON', () => {
    const parsed = parseMlOverrideMismatchEnrichment(
      '{"headline":"Finale is a parent-driven scope reduction, not a product save","commentary":"The manager override is more…',
    );
    expect(parsed?.headline).toBe(
      'Finale is a parent-driven scope reduction, not a product save',
    );
    expect(parsed?.headline).not.toContain('"headline"');
  });

  it('replaces search-meta headlines with customer-context prose', () => {
    const parsed = parseMlOverrideMismatchEnrichment(
      JSON.stringify({
        headline:
          'direct account-level signal in Salesforce for Rubicon, but the first Slack/Gmail/Zoom passes were too restrictive',
        commentary: '',
        customerContext:
          'Rubicon is a utilization and value-realization save. Procurement pressure is elevated and the CSE override reflects a larger downsell than the rep best-case line.',
      }),
    );
    expect(parsed?.headline).toContain('Rubicon');
    expect(parsed?.headline).toContain('utilization');
    expect(parsed?.headline).not.toContain('Slack/Gmail');
  });
});
