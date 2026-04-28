import { describe, expect, it, vi } from 'vitest';
import { fetchAccountContext } from './account-context.js';
import type { GleanClient, GleanDocument } from '../../_shared/src/glean.js';

function makeClient(stubbed: GleanDocument[]): GleanClient {
  return {
    searchAll: vi.fn(async () => stubbed),
    search: vi.fn(),
    getDocuments: vi.fn(),
    healthCheck: vi.fn(),
  } as unknown as GleanClient;
}

describe('fetchAccountContext', () => {
  it('returns plan-shaped docs only and caps at topN', async () => {
    const docs: GleanDocument[] = [
      { title: 'Acme — FY27 Account Plan', url: 'https://docs.google.com/d/1', updateTime: '2026-04-20', datasource: 'gdrive' },
      { title: 'Acme — Q1 Business Review.pptx', url: 'https://docs.google.com/d/2', updateTime: '2026-04-15', datasource: 'gdrive' },
      { title: 'Acme Invoice 12345', url: 'https://docs.google.com/d/3', updateTime: '2026-04-14', datasource: 'gdrive' }, // not plan-shaped
      { title: 'Acme Success Plan v3', url: 'https://docs.google.com/d/4', updateTime: '2026-04-10', datasource: 'gdrive' },
      { title: 'Acme — QBR 2026Q1', url: 'https://docs.google.com/d/5', updateTime: '2026-04-05', datasource: 'gdrive' },
      { title: 'Acme Renewal Review Notes', url: 'https://docs.google.com/d/6', updateTime: '2026-04-01', datasource: 'gdrive' },
    ];
    const client = makeClient(docs);
    const out = await fetchAccountContext(
      client,
      { accountId: 'a1', accountName: 'Acme' },
      { topN: 4 },
    );
    expect(out.accountPlanLinks).toHaveLength(4);
    expect(out.accountPlanLinks.map((l) => l.url)).toEqual([
      'https://docs.google.com/d/1',
      'https://docs.google.com/d/2',
      'https://docs.google.com/d/4',
      'https://docs.google.com/d/5',
    ]);
  });

  it('returns empty arrays when Glean throws', async () => {
    const client = {
      searchAll: vi.fn(async () => {
        throw new Error('Glean down');
      }),
    } as unknown as GleanClient;
    const out = await fetchAccountContext(client, { accountId: 'a1', accountName: 'Acme' });
    expect(out.accountPlanLinks).toEqual([]);
    expect(out.sourceLinks).toEqual([]);
  });

  it('emits SourceLink with citationId when Glean returns one', async () => {
    const docs: GleanDocument[] = [
      {
        title: 'Acme Account Plan',
        url: 'https://docs.google.com/d/1',
        updateTime: '2026-04-20',
        citationId: 'cite-7',
        snippetIndex: 2,
        datasource: 'gdrive',
      },
    ];
    const client = makeClient(docs);
    const out = await fetchAccountContext(client, { accountId: 'a1', accountName: 'Acme' });
    expect(out.sourceLinks[0]).toMatchObject({
      source: 'glean',
      citationId: 'cite-7',
      snippetIndex: 2,
    });
  });

  it('falls back to createTime when updateTime is absent', async () => {
    const docs: GleanDocument[] = [
      { title: 'Acme Plan', url: 'u', createTime: '2024-01-01', datasource: 'gdrive' },
    ];
    const client = makeClient(docs);
    const out = await fetchAccountContext(client, { accountId: 'a1', accountName: 'Acme' });
    expect(out.accountPlanLinks[0]?.lastModified).toBe('2024-01-01');
  });

  it('drops docs without a URL', async () => {
    const docs: GleanDocument[] = [
      { title: 'Untitled plan', updateTime: '2026-01-01', datasource: 'gdrive' },
      { title: 'Real Plan', url: 'u', updateTime: '2026-01-01', datasource: 'gdrive' },
    ];
    const client = makeClient(docs);
    const out = await fetchAccountContext(client, { accountId: 'a1', accountName: 'Acme' });
    expect(out.accountPlanLinks).toHaveLength(1);
    expect(out.accountPlanLinks[0]?.url).toBe('u');
  });
});
