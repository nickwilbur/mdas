import { describe, expect, it } from 'vitest';
import { mapGainsightCta, normalizeName } from './mapper.js';
import type { GleanDocument } from '../../_shared/src/glean.js';

// Scrubbed CTA fixture — real Glean response shape from
// mcp2_search(app:gainsight, query:'Gainsight CTA task'); company name
// + GSID anonymized.
const FIXTURE: GleanDocument = {
  title: 'CTA — Acme, Inc. Low Utilization — Acme, Inc.',
  datasource: 'gainsight',
  url: 'https://zuora.gainsightcloud.com/v1/ui/cockpit#/list/cta/1S0122ABC123FAKEABC',
  matchingFilters: {
    app: ['gainsight'],
    documentcategory: ['PUBLISHED_CONTENT'],
    gscompanygsid: ['1P02CGFAKEXYZ'],
    gscompanyname: ['Acme, Inc.'],
    gsctaname: ['Acme, Inc. Low Utilization'],
    gsctaownername: ['Jane Owner'],
    gsctapriority: ['High'],
    gsctastatus: ['New'],
    gsctatype: ['Risk'],
    gssource: ['Manual'],
    type: ['calltoaction'],
  },
  snippets: [
    'Acme, Inc. Low Utilization',
    'Closed Task Count: 0',
    'Created By (Name): Gainsight Integration',
    'Created Date: 2025-07-09T21:42:20Z',
    'Name: Acme, Inc. Low Utilization',
    'Owner Name: Jane Owner',
    'Priority: High',
    'Status: New',
    'Type: Risk',
    'Due Date: 2026-05-15T11:30:00Z',
    'Percent Complete: 0',
    'Source: Manual',
    'Total Task Count: 4',
  ],
};

describe('normalizeName', () => {
  it('strips common corporate suffixes and punctuation', () => {
    expect(normalizeName('Acme, Inc.')).toBe('acme');
    expect(normalizeName('Pipedrive, Inc.')).toBe('pipedrive');
    expect(normalizeName('24 Hour Fitness Usa, LLC')).toBe('24 hour fitness usa');
    expect(normalizeName('Brame AG')).toBe('brame ag');
    expect(normalizeName('Editions Tissot')).toBe('editions tissot');
  });

  it('is idempotent', () => {
    const a = normalizeName('Acme, Inc.');
    expect(normalizeName(a)).toBe(a);
  });

  it('returns same key for trivial casing differences', () => {
    expect(normalizeName('ACME, INC.')).toBe(normalizeName('acme, inc.'));
  });
});

describe('mapGainsightCta', () => {
  it('extracts every populated field from the fixture', () => {
    const out = mapGainsightCta(FIXTURE);
    expect(out).not.toBeNull();
    expect(out!.companyName).toBe('Acme, Inc.');
    expect(out!.normalizedName).toBe('acme');
    expect(out!.url).toBe(FIXTURE.url);
    expect(out!.task).toEqual({
      id: '1S0122ABC123FAKEABC',
      title: 'Acme, Inc. Low Utilization',
      owner: { id: 'Jane Owner', name: 'Jane Owner' },
      dueDate: '2026-05-15T11:30:00Z',
      status: 'New',
      ctaId: '1S0122ABC123FAKEABC',
    });
  });

  it('marks open vs closed states correctly', () => {
    const open = mapGainsightCta(FIXTURE);
    expect(open!.isOpen).toBe(true);

    const closedSuccessful: GleanDocument = {
      ...FIXTURE,
      matchingFilters: { ...FIXTURE.matchingFilters!, gsctastatus: ['Closed Successful'] },
    };
    expect(mapGainsightCta(closedSuccessful)!.isOpen).toBe(false);

    const closedInvalid: GleanDocument = {
      ...FIXTURE,
      matchingFilters: { ...FIXTURE.matchingFilters!, gsctastatus: ['Closed Invalid'] },
    };
    expect(mapGainsightCta(closedInvalid)!.isOpen).toBe(false);

    const wip: GleanDocument = {
      ...FIXTURE,
      matchingFilters: { ...FIXTURE.matchingFilters!, gsctastatus: ['Work In Progress'] },
    };
    expect(mapGainsightCta(wip)!.isOpen).toBe(true);
  });

  it('returns null when company name and CTA name cannot be resolved', () => {
    expect(mapGainsightCta({ datasource: 'gainsight' } as GleanDocument)).toBeNull();
  });

  it('falls back to title parsing when matchingFilters lack gscompanyname', () => {
    const out = mapGainsightCta({
      ...FIXTURE,
      matchingFilters: {
        ...FIXTURE.matchingFilters!,
        gscompanyname: [],
      },
    });
    // title format is 'CTA — <ctaname> — <company>' so split & pop gets company
    expect(out?.companyName).toBe('Acme, Inc.');
  });

  it('synthesizes a stable id when the URL has no /cta/<id> segment', () => {
    const noUrl: GleanDocument = { ...FIXTURE, url: undefined };
    const out = mapGainsightCta(noUrl);
    expect(out!.task.id).toBe('gs:acme:acme low utilization');
    expect(out!.task.ctaId).toBeNull();
  });

  it('handles missing dueDate / ownerName gracefully', () => {
    const sparse: GleanDocument = {
      ...FIXTURE,
      matchingFilters: { ...FIXTURE.matchingFilters!, gsctaownername: [] },
      snippets: ['Name: Acme, Inc. Low Utilization', 'Status: New'],
    };
    const out = mapGainsightCta(sparse);
    expect(out!.task.owner).toBeNull();
    expect(out!.task.dueDate).toBeNull();
  });

  it('captures Created Date as the ctaIndexedAt freshness stamp', () => {
    const out = mapGainsightCta(FIXTURE);
    expect(out!.ctaIndexedAt).toBe('2025-07-09T21:42:20Z');
  });

  it('falls back to doc.updateTime when the snippet has no Created Date', () => {
    const out = mapGainsightCta({
      ...FIXTURE,
      snippets: ['Name: Acme, Inc. Low Utilization'],
      updateTime: '2026-04-28T18:00:00Z',
    });
    expect(out!.ctaIndexedAt).toBe('2026-04-28T18:00:00Z');
  });
});
