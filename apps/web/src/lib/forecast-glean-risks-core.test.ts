import { describe, expect, it } from 'vitest';
import {
  MAX_GLEAN_FLAGGED_PER_QUARTER,
  MAX_GLEAN_FLAGGED_RATIONALE_CHARS,
  parseGleanFlaggedRisks,
} from './forecast-glean-risks-core';

const UNIVERSE = {
  quarter: 'current' as const,
  accounts: [
    { accountId: '001REAL', accountName: 'Real Co' },
    { accountId: '001OTHER', accountName: 'Other Co' },
  ],
};

describe('parseGleanFlaggedRisks', () => {
  it('parses valid entries from the bounded universe', () => {
    const risks = parseGleanFlaggedRisks(
      JSON.stringify([
        {
          accountId: '001REAL',
          rationale: 'Slack escalation thread this week on renewal discount.',
        },
      ]),
      UNIVERSE,
    );
    expect(risks).toEqual([
      {
        accountId: '001REAL',
        accountName: 'Real Co',
        quarter: 'current',
        rationale: 'Slack escalation thread this week on renewal discount.',
      },
    ]);
  });

  it('drops hallucinated accountIds not in the bounded universe', () => {
    const risks = parseGleanFlaggedRisks(
      JSON.stringify([
        {
          accountId: '001FAKE',
          rationale: 'Invented account should never appear on the leadership call.',
        },
        {
          accountId: '001REAL',
          rationale: 'Grounded signal only.',
        },
      ]),
      UNIVERSE,
    );
    expect(risks).toHaveLength(1);
    expect(risks[0]!.accountId).toBe('001REAL');
  });

  it('parses JSON inside markdown fences', () => {
    const risks = parseGleanFlaggedRisks(
      '```json\n[{"accountId":"001OTHER","rationale":"Procurement email flagged vendor review."}]\n```',
      UNIVERSE,
    );
    expect(risks[0]?.accountName).toBe('Other Co');
  });

  it('returns empty array for invalid JSON and non-arrays', () => {
    expect(parseGleanFlaggedRisks('not json', UNIVERSE)).toEqual([]);
    expect(parseGleanFlaggedRisks('{"accountId":"001REAL"}', UNIVERSE)).toEqual([]);
  });

  it('caps rationale length and max entries per quarter', () => {
    const longRationale = 'R'.repeat(MAX_GLEAN_FLAGGED_RATIONALE_CHARS + 50);
    const payload = JSON.stringify(
      Array.from({ length: MAX_GLEAN_FLAGGED_PER_QUARTER + 2 }, (_, i) => ({
        accountId: i % 2 === 0 ? '001REAL' : '001OTHER',
        rationale: i === 0 ? longRationale : `Signal ${i}`,
      })),
    );
    const risks = parseGleanFlaggedRisks(payload, UNIVERSE);
    expect(risks.length).toBeLessThanOrEqual(MAX_GLEAN_FLAGGED_PER_QUARTER);
    expect(risks[0]!.rationale.endsWith('…')).toBe(true);
  });
});
