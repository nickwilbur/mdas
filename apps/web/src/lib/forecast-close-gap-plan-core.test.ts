import { describe, expect, it } from 'vitest';
import {
  MAX_CLOSE_GAP_ACTION_CHARS,
  MAX_CLOSE_GAP_STEPS,
  buildCloseGapActionPlanPrompt,
  parseCloseGapActionSteps,
} from './forecast-close-gap-plan-core';
import type { CloseGapAccountContext } from '@mdas/forecast-generator';

const SAMPLE_CTX: CloseGapAccountContext = {
  accountId: 'GAP1',
  accountName: 'Gap Co',
  band: 'red',
  closeDate: '2026-04-15',
  atrUSD: 420_000,
  forecastMostLikelyUSD: -50_000,
  cerebroRiskCategory: 'High',
  cseSentiment: 'Red',
  accountOwnerName: 'Alice Owner',
  assignedCseName: 'Carol CSE',
  assignedCseId: 'U-CSE',
  salesEngineerName: 'Sam SE',
};

describe('buildCloseGapActionPlanPrompt', () => {
  it('embeds char limits and Assigned CSE owner in the prompt', () => {
    const prompt = buildCloseGapActionPlanPrompt(
      SAMPLE_CTX,
      '2026-05-29',
      'FY27 Q3',
    );
    expect(prompt).toContain(`≤${MAX_CLOSE_GAP_ACTION_CHARS} chars`);
    expect(prompt).toContain('Carol CSE');
    expect(prompt).toContain('Gap Co');
    expect(prompt).toContain('RED-band churn-save renewal');
  });

  it('uses yellow-band phrasing for yellow accounts', () => {
    const prompt = buildCloseGapActionPlanPrompt(
      { ...SAMPLE_CTX, band: 'yellow' },
      '2026-05-29',
      'FY27 Q3',
    );
    expect(prompt).toContain('YELLOW-band churn-save renewal');
  });
});

describe('parseCloseGapActionSteps', () => {
  it('parses a JSON array of owner→action steps', () => {
    const steps = parseCloseGapActionSteps(
      JSON.stringify([
        { owner: 'Carol CSE', action: 'Schedule exec sponsor call by 6/5.' },
        { owner: 'Carol CSE', action: 'Deliver value-realization recap.' },
      ]),
      SAMPLE_CTX,
    );
    expect(steps).toEqual([
      { owner: 'Carol CSE', action: 'Schedule exec sponsor call by 6/5.' },
      { owner: 'Carol CSE', action: 'Deliver value-realization recap.' },
    ]);
  });

  it('strips markdown JSON fences before parsing', () => {
    const steps = parseCloseGapActionSteps(
      '```json\n[{"owner":"Carol CSE","action":"Escalate procurement blockers."}]\n```',
      SAMPLE_CTX,
    );
    expect(steps).toEqual([
      { owner: 'Carol CSE', action: 'Escalate procurement blockers.' },
    ]);
  });

  it('stamps Assigned CSE when Glean returns a Salesforce User Id owner', () => {
    const steps = parseCloseGapActionSteps(
      JSON.stringify([
        { owner: '0054u000006gCXoAAM', action: 'Confirm renewal scope with champion.' },
      ]),
      SAMPLE_CTX,
    );
    expect(steps?.[0]?.owner).toBe('Carol CSE');
  });

  it('stamps Assigned CSE when Glean returns a stale SE or AE name', () => {
    const steps = parseCloseGapActionSteps(
      JSON.stringify([
        { owner: 'Sam SE', action: 'Review deployment blockers.' },
        { owner: 'Alice Owner', action: 'Align on discount guardrails.' },
      ]),
      SAMPLE_CTX,
    );
    expect(steps?.every((s) => s.owner === 'Carol CSE')).toBe(true);
  });

  it('caps step count and field lengths', () => {
    const longAction = 'A'.repeat(MAX_CLOSE_GAP_ACTION_CHARS + 40);
    const steps = parseCloseGapActionSteps(
      JSON.stringify(
        Array.from({ length: 6 }, (_, i) => ({
          owner: 'Carol CSE',
          action: i === 0 ? longAction : `Step ${i}`,
        })),
      ),
      SAMPLE_CTX,
    );
    expect(steps).toHaveLength(MAX_CLOSE_GAP_STEPS);
    expect(steps?.[0]?.action.endsWith('…')).toBe(true);
    expect(steps?.[0]?.action.length).toBeLessThanOrEqual(
      MAX_CLOSE_GAP_ACTION_CHARS + 1,
    );
  });

  it('returns null for non-array JSON', () => {
    expect(
      parseCloseGapActionSteps(
        JSON.stringify({ owner: 'Carol CSE', action: 'Nope' }),
        SAMPLE_CTX,
      ),
    ).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseCloseGapActionSteps('not json at all', SAMPLE_CTX)).toBeNull();
  });

  it('skips entries without a non-empty action string', () => {
    const steps = parseCloseGapActionSteps(
      JSON.stringify([
        { owner: 'Carol CSE', action: '' },
        { owner: 'Carol CSE' },
        { action: 'Valid step only.' },
      ]),
      SAMPLE_CTX,
    );
    expect(steps).toEqual([
      { owner: 'Carol CSE', action: 'Valid step only.' },
    ]);
  });
});
