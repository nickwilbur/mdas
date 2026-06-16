import { describe, expect, it } from 'vitest';
import {
  MAX_GLEAN_FLAGGED_PER_QUARTER,
  MAX_GLEAN_RATIONALE_CHARS,
  parseGleanFlaggedRisksResponse,
  type QuarterAccountUniverse,
} from './forecast-glean-risks-core';

const UNIVERSE: QuarterAccountUniverse = {
  quarter: 'current',
  fiscalQuarterLabel: 'FY27 Q1',
  accounts: [
    { accountId: 'A1', accountName: 'Acme Corp', alreadyStructurallyFlagged: false },
    { accountId: 'A2', accountName: 'Beta LLC', alreadyStructurallyFlagged: false },
  ],
};

describe('parseGleanFlaggedRisksResponse', () => {
  it('parses valid entries from the bounded universe', () => {
    const out = parseGleanFlaggedRisksResponse(
      JSON.stringify([
        {
          accountId: 'A1',
          rationale:
            'Slack escalation this week — CFO requested 30% discount as renewal condition.',
        },
      ]),
      UNIVERSE,
    );
    expect(out).toEqual([
      {
        accountId: 'A1',
        accountName: 'Acme Corp',
        quarter: 'current',
        rationale:
          'Slack escalation this week — CFO requested 30% discount as renewal condition.',
      },
    ]);
  });

  it('drops accountIds not in the bounded universe (hallucination guard)', () => {
    const out = parseGleanFlaggedRisksResponse(
      JSON.stringify([
        {
          accountId: 'A1',
          rationale: 'Grounded signal on Acme.',
        },
        {
          accountId: 'INVENTED-999',
          rationale: 'Model hallucinated this account.',
        },
      ]),
      UNIVERSE,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.accountId).toBe('A1');
  });

  it('returns an empty array for invalid JSON or non-array payloads', () => {
    expect(parseGleanFlaggedRisksResponse('not json', UNIVERSE)).toEqual([]);
    expect(
      parseGleanFlaggedRisksResponse('{"accountId":"A1"}', UNIVERSE),
    ).toEqual([]);
  });

  it('strips markdown fences before parsing', () => {
    const out = parseGleanFlaggedRisksResponse(
      '```json\n[{"accountId":"A2","rationale":"Procurement email flagged vendor review."}]\n```',
      UNIVERSE,
    );
    expect(out).toEqual([
      {
        accountId: 'A2',
        accountName: 'Beta LLC',
        quarter: 'current',
        rationale: 'Procurement email flagged vendor review.',
      },
    ]);
  });

  it('truncates overlong rationales and caps entry count', () => {
    const longRationale = 'R'.repeat(MAX_GLEAN_RATIONALE_CHARS + 50);
    const entries = Array.from({ length: MAX_GLEAN_FLAGGED_PER_QUARTER + 2 }, (_, i) => ({
      accountId: i % 2 === 0 ? 'A1' : 'A2',
      rationale: `${longRationale}-${i}`,
    }));
    const out = parseGleanFlaggedRisksResponse(JSON.stringify(entries), UNIVERSE);
    expect(out.length).toBe(MAX_GLEAN_FLAGGED_PER_QUARTER);
    expect(out[0]!.rationale.length).toBeLessThanOrEqual(
      MAX_GLEAN_RATIONALE_CHARS + 1,
    );
    expect(out[0]!.rationale.endsWith('…')).toBe(true);
  });
});
