import { describe, expect, it } from 'vitest';
import { mapCerebroDocument } from './mapper.js';
import type { GleanDocument } from '../../_shared/src/glean.js';

const REFRESH_AT = new Date('2026-04-28T18:00:00.000Z');
const CTX = { refreshAt: REFRESH_AT };

// Scrubbed fixture: real Glean response shape from
//   mcp2_read_document(['https://cerebro.na.zuora.com/salesforce/accounts/<sfid>/health'])
// with PII anonymized (account name + SFID synthesized).
const FIXTURE: GleanDocument = {
  title: 'Health Risk — Pipedrive, Inc.',
  datasource: 'cerebro',
  url: 'https://cerebro.na.zuora.com/salesforce/accounts/0017000000FAKEACE/health',
  updateTime: '2026-04-21T18:04:04Z',
  matchingFilters: {
    app: ['cerebro'],
    crsalesforceaccountid: ['0017000000FAKEACE'],
    crcustomername: ['Pipedrive Inc.'],
    crengagementrisk: ['false'],
    crexpertiserisk: ['true'],
    crlegacytechrisk: ['false'],
    crpricingrisk: ['false'],
    crsharerisk: ['false'],
    crsuiterisk: ['false'],
    crutilizationrisk: ['true'],
    crhasenhancedservices: ['false'],
    crhasesa: ['false'],
    crhasinvoicesettlement: ['true'],
    crhasms: ['false'],
    crhaspes: ['false'],
    crhastam: ['false'],
    crhasuno: ['true'],
    crreportinguse: ['true'],
    type: ['healthrisk'],
  },
  richDocumentData: {
    mimeType: 'application/json',
    status: 'OK',
    content: JSON.stringify({
      pageBody: 'Pipedrive, Inc.',
      customFields: [
        { id: 'crBillingProductShare', text: 'Billing Product Share (%): 284' },
        { id: 'crCustomerName', text: 'Customer Name: Pipedrive, Inc.' },
        { id: 'crEngagementRisk', text: 'Engagement Risk: false' },
        { id: 'crExpertiseRisk', text: 'Expertise Risk: true' },
      ],
      facets: {
        keywordFacets: {
          crCustomerName: ['Pipedrive, Inc.'],
          crSalesforceAccountId: ['0017000000FAKEACE'],
          crEngagementRisk: ['false'],
          crExpertiseRisk: ['true'],
          crLegacyTechRisk: ['false'],
          crPricingRisk: ['false'],
          crShareRisk: ['false'],
          crSuiteRisk: ['false'],
          crUtilizationRisk: ['true'],
          crHasEnhancedServices: ['false'],
          crHasEsa: ['false'],
          crHasInvoiceSettlement: ['true'],
          crHasMs: ['false'],
          crHasPes: ['false'],
          crHasTam: ['false'],
          crHasUno: ['true'],
          crReportingUse: ['true'],
        },
        intFacets: {
          crProjectedBillingUtilization: 23,
          crProjectedRevenueUtilization: 19,
          crBillingProductShare: 284,
          crRevenueProductShare: 284,
          crExecutiveMeetingCount: 6,
          crOrdersApiUsage: 100,
          crBillingCost: 0,
          crRevenueCost: 0,
          crEmailedInvoices: 0,
          crEpaymentsProcessed: 222313,
          crInvoicesPosted: 227031,
          crJournalEntries: 122,
          crOrders: 2014,
          crQuotes: 0,
          crRevenueAmount: 50510394,
          crDso: 0,
        },
      },
    }),
  },
};

describe('mapCerebroDocument', () => {
  it('returns null when accountId cannot be extracted', () => {
    const doc: GleanDocument = { title: 'unanchored', datasource: 'cerebro' };
    expect(mapCerebroDocument(doc, CTX)).toBeNull();
  });

  it('extracts accountId from URL when matchingFilters/keywordFacets are absent', () => {
    const doc: GleanDocument = {
      title: 'partial doc',
      datasource: 'cerebro',
      url: 'https://cerebro.na.zuora.com/salesforce/accounts/0017000000ANOTHID/health',
    };
    const out = mapCerebroDocument(doc, CTX);
    expect(out?.accountId).toBe('0017000000ANOTHID');
  });

  it('produces all 7 risk booleans from a populated fixture', () => {
    const out = mapCerebroDocument(FIXTURE, CTX);
    expect(out).not.toBeNull();
    expect(out!.accountId).toBe('0017000000FAKEACE');
    expect(out!.patch.cerebroRisks).toEqual({
      utilizationRisk: true,
      engagementRisk: false,
      suiteRisk: false,
      shareRisk: false,
      legacyTechRisk: false,
      expertiseRisk: true,
      pricingRisk: false,
    });
  });

  it('captures the documented sub-metric integer set', () => {
    const out = mapCerebroDocument(FIXTURE, CTX);
    const m = out!.patch.cerebroSubMetrics!;
    expect(m['crProjectedBillingUtilization']).toBe(23);
    expect(m['crProjectedRevenueUtilization']).toBe(19);
    expect(m['crExecutiveMeetingCount']).toBe(6);
    expect(m['crBillingProductShare']).toBe(284);
    expect(m['crRevenueProductShare']).toBe(284);
    expect(m['crOrdersApiUsage']).toBe(100);
    expect(m['crEpaymentsProcessed']).toBe(222313);
    // has-flags converted to booleans:
    expect(m['crHasInvoiceSettlement']).toBe(true);
    expect(m['crHasUno']).toBe(true);
    expect(m['crHasEsa']).toBe(false);
    expect(m['crReportingUse']).toBe(true);
  });

  it('intentionally omits Risk Category and Risk Analysis (not in Glean)', () => {
    const out = mapCerebroDocument(FIXTURE, CTX);
    expect(out!.patch.cerebroRiskCategory).toBeUndefined();
    expect(out!.patch.cerebroRiskAnalysis).toBeUndefined();
  });

  it('emits a Cerebro source link with optional citation tuple', () => {
    const out = mapCerebroDocument(FIXTURE, CTX);
    expect(out!.patch.sourceLinks).toEqual([
      {
        source: 'cerebro',
        label: 'Cerebro Health Risk',
        url: 'https://cerebro.na.zuora.com/salesforce/accounts/0017000000FAKEACE/health',
      },
    ]);
  });

  it('preserves citationId/snippetIndex when Glean returns them', () => {
    const docWithCitation: GleanDocument = {
      ...FIXTURE,
      citationId: 'cite-abc-123',
      snippetIndex: 0,
    };
    const out = mapCerebroDocument(docWithCitation, CTX);
    expect(out!.patch.sourceLinks?.[0]).toMatchObject({
      citationId: 'cite-abc-123',
      snippetIndex: 0,
    });
  });

  it('stamps lastFetchedFromSource: { cerebro: refreshAt }', () => {
    const out = mapCerebroDocument(FIXTURE, CTX);
    expect(out!.patch.lastFetchedFromSource).toEqual({
      cerebro: REFRESH_AT.toISOString(),
    });
  });

  it('falls back to matchingFilters when richDocumentData is absent', () => {
    const docNoRich: GleanDocument = { ...FIXTURE, richDocumentData: undefined };
    const out = mapCerebroDocument(docNoRich, CTX);
    expect(out!.patch.cerebroRisks).toEqual({
      utilizationRisk: true,
      engagementRisk: false,
      suiteRisk: false,
      shareRisk: false,
      legacyTechRisk: false,
      expertiseRisk: true,
      pricingRisk: false,
    });
    // No intFacets without rich content, so sub-metrics empty.
    expect(out!.patch.cerebroSubMetrics).toEqual({});
  });

  it('captures Cerebro updateTime for surfaces that show "Glean indexed at"', () => {
    const out = mapCerebroDocument(FIXTURE, CTX);
    expect(out!.cerebroIndexedAt).toBe('2026-04-21T18:04:04Z');
  });
});
