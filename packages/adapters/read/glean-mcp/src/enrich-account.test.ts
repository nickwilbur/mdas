import { describe, expect, it, vi } from 'vitest';
import type { CanonicalAccount } from '@mdas/canonical';
import type { GleanClient } from '../../_shared/src/glean.js';

vi.mock('./account-context.js', () => ({
  fetchAccountContext: vi.fn(),
}));
vi.mock('./evidence.js', () => ({
  fetchAccountEvidence: vi.fn(),
  applyContextAndEvidenceToAccount: vi.fn(),
}));

import { fetchAccountContext } from './account-context.js';
import { applyContextAndEvidenceToAccount, fetchAccountEvidence } from './evidence.js';
import { enrichGleanMcpAccount } from './enrich-account.js';

const client = {} as GleanClient;
const refreshAt = new Date('2026-06-01T12:00:00Z');

function baseAccount(): CanonicalAccount {
  return {
    accountId: 'A1',
    accountName: 'Acme',
    salesforceSlackChannelUrl: null,
    accountPlanLinks: [],
    recentMeetings: [],
  } as CanonicalAccount;
}

describe('enrichGleanMcpAccount', () => {
  it('returns null when context and evidence are both empty', async () => {
    vi.mocked(fetchAccountContext).mockResolvedValue({
      accountPlanLinks: [],
      sourceLinks: [],
    });
    vi.mocked(fetchAccountEvidence).mockResolvedValue({
      recentMeetings: [],
      sourceLinks: [],
    });

    const out = await enrichGleanMcpAccount(client, baseAccount(), refreshAt);
    expect(out).toBeNull();
    expect(applyContextAndEvidenceToAccount).not.toHaveBeenCalled();
  });

  it('builds a patch when evidence has meetings', async () => {
    vi.mocked(fetchAccountContext).mockResolvedValue({
      accountPlanLinks: [],
      sourceLinks: [],
    });
    vi.mocked(fetchAccountEvidence).mockResolvedValue({
      recentMeetings: [{ title: 'QBR', date: '2026-05-20', url: 'https://cal/1' }],
      sourceLinks: [],
    });

    const out = await enrichGleanMcpAccount(client, baseAccount(), refreshAt);
    expect(out).toEqual({ accountId: 'A1' });
    expect(applyContextAndEvidenceToAccount).toHaveBeenCalledOnce();
  });

  it('fetches context and evidence in parallel', async () => {
    const order: string[] = [];
    vi.mocked(fetchAccountContext).mockImplementation(async () => {
      order.push('context-start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('context-end');
      return { accountPlanLinks: [{ title: 'Plan', url: 'https://docs/1' }], sourceLinks: [] };
    });
    vi.mocked(fetchAccountEvidence).mockImplementation(async () => {
      order.push('evidence-start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('evidence-end');
      return { recentMeetings: [], sourceLinks: [] };
    });

    await enrichGleanMcpAccount(client, baseAccount(), refreshAt);
    expect(order.indexOf('context-start')).toBeLessThan(order.indexOf('context-end'));
    expect(order.indexOf('evidence-start')).toBeLessThan(order.indexOf('evidence-end'));
    expect(order.filter((e) => e.endsWith('-start'))).toHaveLength(2);
  });
});
