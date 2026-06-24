import { describe, it, expect } from 'vitest';
import {
  attachCtasToRenewalRows,
  deriveCtaAccountId,
  extractOpportunityIdFromSalesforceUrl,
  indexCtasByOpportunityId,
  isCtaOpen,
  normalizeCtaStatus,
  resolveRenewalOpportunityId,
  enrichCtaLogEntry,
  carryForwardCtaProgress,
  indexCtaLogByDedupKey,
} from './progress.js';
import type { CTALogEntry } from './types.js';

function makeLogEntry(overrides: Partial<CTALogEntry> = {}): CTALogEntry {
  return {
    cta_id: 'cta-1',
    account_name: 'Acme',
    salesforce_account_id: '001ACC',
    play_type: 'dark_renewal',
    risk_color: 'Red',
    primary_owner: { name: 'CSE', role: 'CSE' },
    deadline: '2026-08-01',
    renewal_opportunity_id: '006OPP',
    posted_at: '2026-06-01T12:00:00Z',
    posted_to_channel: '#expand3-risk-signals',
    status: 'open',
    last_checked_at: null,
    escalation_message_id: null,
    ...overrides,
  };
}

describe('normalizeCtaStatus', () => {
  it('maps legacy statuses to canonical values', () => {
    expect(normalizeCtaStatus('closed_done')).toBe('done');
    expect(normalizeCtaStatus('stalled')).toBe('blocked');
    expect(normalizeCtaStatus('in_progress')).toBe('in_progress');
  });
});

describe('isCtaOpen', () => {
  it('treats done and legacy closed as not open', () => {
    expect(isCtaOpen('done')).toBe(false);
    expect(isCtaOpen('closed_done')).toBe(false);
    expect(isCtaOpen('open')).toBe(true);
    expect(isCtaOpen('blocked')).toBe(true);
  });
});

describe('extractOpportunityIdFromSalesforceUrl', () => {
  it('parses Lightning and classic opportunity URLs', () => {
    expect(
      extractOpportunityIdFromSalesforceUrl(
        'https://zuora.lightning.force.com/lightning/r/Opportunity/006Po00000TEST01A/view',
      ),
    ).toBe('006Po00000TEST01A');
    expect(
      extractOpportunityIdFromSalesforceUrl(
        'https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000FavRvIAJ/view',
      ),
    ).toBe('006Po00000FavRvIAJ');
  });
});

describe('resolveRenewalOpportunityId', () => {
  it('prefers explicit id over URL', () => {
    expect(
      resolveRenewalOpportunityId({
        renewal_opportunity_id: '006Po00000EXPLICIT',
        renewal_opportunity_url: 'https://x/Opportunity/006Po00000FROMURL/view',
      }),
    ).toBe('006Po00000EXPLICIT');
  });

  it('falls back to URL when id missing', () => {
    expect(
      resolveRenewalOpportunityId({
        renewal_opportunity_id: null,
        renewal_opportunity_url:
          'https://x/Opportunity/006Po00000FROMURL/view',
      }),
    ).toBe('006Po00000FROMURL');
  });
});

describe('deriveCtaAccountId', () => {
  const opps = [{ opportunityId: '006OPP', accountId: '001FROM-OPP' }];

  it('derives account from linked renewal opportunity', () => {
    expect(
      deriveCtaAccountId(
        { renewal_opportunity_id: '006OPP', salesforce_account_id: '001ACC' },
        opps,
      ),
    ).toBe('001FROM-OPP');
  });

  it('derives account from linked renewal opportunity via URL fallback', () => {
    expect(
      deriveCtaAccountId(
        {
          renewal_opportunity_id: null,
          renewal_opportunity_url: 'https://x/Opportunity/006Po00000FavRvIAJ/view',
          salesforce_account_id: '001ACC',
        },
        [{ opportunityId: '006Po00000FavRvIAJ', accountId: '001FROM-OPP' }],
      ),
    ).toBe('001FROM-OPP');
  });

  it('falls back to salesforce account when no opportunity link', () => {
    expect(
      deriveCtaAccountId(
        { renewal_opportunity_id: null, salesforce_account_id: '001ACC' },
        opps,
      ),
    ).toBe('001ACC');
  });
});

describe('indexCtasByOpportunityId', () => {
  it('indexes open CTAs by opportunity id', () => {
    const ctas = [
      makeLogEntry({ cta_id: 'a', renewal_opportunity_id: '006OPP', status: 'open' }),
      makeLogEntry({ cta_id: 'b', renewal_opportunity_id: '006OPP', status: 'done' }),
    ];
    const index = indexCtasByOpportunityId(ctas, [
      { opportunityId: '006OPP', accountId: '001FROM-OPP' },
    ]);
    expect(index.size).toBe(1);
    expect(index.get('006OPP')?.ctaId).toBe('a');
    expect(index.get('006OPP')?.accountId).toBe('001FROM-OPP');
  });

  it('indexes CTAs when only renewal_opportunity_url is present', () => {
    const ctas = [
      makeLogEntry({
        cta_id: 'legacy',
        renewal_opportunity_id: undefined,
        renewal_opportunity_url: 'https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000LEGACY1/view',
        status: 'open',
      }),
    ];
    const index = indexCtasByOpportunityId(ctas, [
      { opportunityId: '006Po00000LEGACY1', accountId: '001LEG' },
    ]);
    expect(index.get('006Po00000LEGACY1')?.ctaId).toBe('legacy');
  });
});

describe('enrichCtaLogEntry', () => {
  it('updates dedup_key when opportunity id is resolved from URL', () => {
    const enriched = enrichCtaLogEntry({
      renewal_opportunity_id: null,
      renewal_opportunity_url:
        'https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00000LEGACY1/view',
      salesforce_account_id: '001ACC',
      play_type: 'dark_account',
      dedup_key: '001ACC:dark_account',
    });
    expect(enriched.renewal_opportunity_id).toBe('006Po00000LEGACY1');
    expect(enriched.dedup_key).toBe('006Po00000LEGACY1:dark_account');
  });
});

describe('carryForwardCtaProgress', () => {
  it('preserves status and notes when scan regenerates with a new cta_id', () => {
    const prior = makeLogEntry({
      cta_id: 'old-id',
      status: 'in_progress',
      progress_note: 'Called champion',
      dedup_key: '006Po00000LEGACY1:dark_account',
      renewal_opportunity_id: '006Po00000LEGACY1',
    });
    const priorByDedup = indexCtaLogByDedupKey([prior]);
    const fresh = makeLogEntry({
      cta_id: 'new-id',
      status: 'open',
      progress_note: null,
      dedup_key: '006Po00000LEGACY1:dark_account',
      renewal_opportunity_id: '006Po00000LEGACY1',
    });

    const merged = carryForwardCtaProgress(fresh, priorByDedup);
    expect(merged.cta_id).toBe('new-id');
    expect(merged.status).toBe('in_progress');
    expect(merged.progress_note).toBe('Called champion');
  });
});

describe('attachCtasToRenewalRows', () => {
  it('attaches CTA summary to matching renewal rows', () => {
    const rows = [
      {
        opportunityId: '006OPP',
        accountId: '001FROM-OPP',
        accountName: 'Acme',
      },
      {
        opportunityId: '006OTHER',
        accountId: '001OTHER',
        accountName: 'Other',
      },
    ];
    const ctas = [
      makeLogEntry({
        renewal_opportunity_id: '006OPP',
        status: 'in_progress',
        progress_note: 'Reached out to champion',
        assigned_owner: 'Pat CSE',
      }),
    ];

    const attached = attachCtasToRenewalRows(rows, ctas);
    expect(attached[0]?.cta?.status).toBe('in_progress');
    expect(attached[0]?.cta?.progressNote).toBe('Reached out to champion');
    expect(attached[0]?.cta?.accountId).toBe('001FROM-OPP');
    expect(attached[1]?.cta).toBeNull();
  });
});
