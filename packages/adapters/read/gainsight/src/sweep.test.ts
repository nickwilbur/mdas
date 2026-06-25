import { describe, expect, it, vi } from 'vitest';
import type { GleanClient, GleanDocument } from '../../_shared/src/glean.js';
import { fetchGainsightCtaDocuments, isGainsightDocument } from './sweep.js';

describe('isGainsightDocument', () => {
  it('matches datasource gainsight', () => {
    expect(isGainsightDocument({ datasource: 'gainsight' })).toBe(true);
    expect(isGainsightDocument({ datasource: 'cerebro' })).toBe(false);
  });
});

describe('fetchGainsightCtaDocuments', () => {
  it('uses franchise sweep and dedupes by URL', async () => {
    const docs: GleanDocument[] = [
      {
        datasource: 'gainsight',
        url: 'https://gainsight.example/cta/1',
        matchingFilters: { gscompanyname: ['Acme Corp'] },
      },
      {
        datasource: 'gainsight',
        url: 'https://gainsight.example/cta/1',
        matchingFilters: { gscompanyname: ['Acme Corp'] },
      },
    ];
    const searchAll = vi.fn().mockResolvedValue(docs);
    const client = { searchAll } as unknown as GleanClient;

    const result = await fetchGainsightCtaDocuments(client);
    expect(searchAll).toHaveBeenCalledTimes(1);
    expect(result.docs).toHaveLength(1);
  });
});
