import { describe, expect, it } from 'vitest';
import type { CloseGapAccountContext } from '@mdas/forecast-generator';
import {
  MAX_CLOSE_GAP_ACTION_CHARS,
  MAX_CLOSE_GAP_STEPS,
  parseCloseGapActionSteps,
} from './forecast-close-gap-plan-core';

const SAMPLE_CTX: CloseGapAccountContext = {
  accountId: 'GAP1',
  accountName: 'Gap Co',
  band: 'red',
  atrUSD: 420_000,
  closeDate: '2026-10-17',
  forecastMostLikelyUSD: -50_000,
  cerebroRiskCategory: 'High',
  cseSentiment: 'Red',
  scNextSteps: 'Exec call scheduled',
  accountOwnerId: '005AO',
  accountOwnerName: 'Alice Owner',
  assignedCseId: '005CSE',
  assignedCseName: 'Carol CSE',
  salesEngineerId: '005SE',
  salesEngineerName: 'Sam SE',
};

describe('parseCloseGapActionSteps', () => {
  it('parses a JSON array and stamps every step with Assigned CSE', () => {
    const steps = parseCloseGapActionSteps(
      JSON.stringify([
        {
          owner: 'Sam SE',
          action: 'Schedule exec sponsor call by 6/5.',
        },
        {
          owner: 'Alice Owner',
          action: 'Deliver value-realization recap.',
        },
      ]),
      SAMPLE_CTX,
    );
    expect(steps).toEqual([
      { owner: 'Carol CSE', action: 'Schedule exec sponsor call by 6/5.' },
      { owner: 'Carol CSE', action: 'Deliver value-realization recap.' },
    ]);
  });

  it('parses JSON inside markdown fences', () => {
    const steps = parseCloseGapActionSteps(
      '```json\n[{"owner":"Carol CSE","action":"Confirm procurement timeline."}]\n```',
      SAMPLE_CTX,
    );
    expect(steps).toEqual([
      { owner: 'Carol CSE', action: 'Confirm procurement timeline.' },
    ]);
  });

  it('returns null for invalid JSON, non-arrays, and empty action lists', () => {
    expect(parseCloseGapActionSteps('not json', SAMPLE_CTX)).toBeNull();
    expect(
      parseCloseGapActionSteps('{"owner":"Carol CSE"}', SAMPLE_CTX),
    ).toBeNull();
    expect(parseCloseGapActionSteps('[]', SAMPLE_CTX)).toBeNull();
    expect(
      parseCloseGapActionSteps(
        JSON.stringify([{ owner: 'Carol CSE', action: '   ' }]),
        SAMPLE_CTX,
      ),
    ).toBeNull();
  });

  it('caps step count and field lengths', () => {
    const longAction = 'A'.repeat(MAX_CLOSE_GAP_ACTION_CHARS + 40);
    const steps = parseCloseGapActionSteps(
      JSON.stringify(
        Array.from({ length: MAX_CLOSE_GAP_STEPS + 2 }, (_, i) => ({
          owner: 'Carol CSE',
          action: i === 0 ? longAction : `Step ${i + 1}`,
        })),
      ),
      SAMPLE_CTX,
    );
    expect(steps).toHaveLength(MAX_CLOSE_GAP_STEPS);
    expect(steps![0]!.action.endsWith('…')).toBe(true);
    expect(steps![0]!.action.length).toBeLessThanOrEqual(
      MAX_CLOSE_GAP_ACTION_CHARS + 1,
    );
  });

  it('skips malformed entries but keeps well-formed ones', () => {
    const steps = parseCloseGapActionSteps(
      JSON.stringify([
        null,
        { owner: 'Carol CSE' },
        { action: 123 },
        { owner: 'Carol CSE', action: 'Valid step only.' },
      ]),
      SAMPLE_CTX,
    );
    expect(steps).toEqual([
      { owner: 'Carol CSE', action: 'Valid step only.' },
    ]);
  });
});
