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
  closeDate: '2026-04-15',
  atrUSD: 420_000,
  assignedCseId: 'U-CSE',
  assignedCseName: 'Carol CSE',
  accountOwnerId: 'U-AO',
  accountOwnerName: 'Alice Owner',
  salesEngineerName: 'Sam SE',
};

describe('parseCloseGapActionSteps', () => {
  it('parses a valid JSON array and stamps Assigned CSE as owner', () => {
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
    expect(steps).toHaveLength(2);
    expect(steps![0]).toEqual({
      owner: 'Carol CSE',
      action: 'Schedule exec sponsor call by 6/5.',
    });
    expect(steps![1]).toEqual({
      owner: 'Carol CSE',
      action: 'Deliver value-realization recap.',
    });
  });

  it('strips markdown fences before parsing', () => {
    const steps = parseCloseGapActionSteps(
      '```json\n[{"owner":"Carol CSE","action":"Confirm renewal scope."}]\n```',
      SAMPLE_CTX,
    );
    expect(steps).toEqual([
      { owner: 'Carol CSE', action: 'Confirm renewal scope.' },
    ]);
  });

  it('returns null for invalid JSON or non-array payloads', () => {
    expect(parseCloseGapActionSteps('not json', SAMPLE_CTX)).toBeNull();
    expect(
      parseCloseGapActionSteps('{"owner":"Carol CSE"}', SAMPLE_CTX),
    ).toBeNull();
    expect(parseCloseGapActionSteps('[]', SAMPLE_CTX)).toBeNull();
  });

  it('skips malformed entries and caps step count', () => {
    const payload = JSON.stringify([
      { owner: 'Carol CSE', action: 'Step 1' },
      { owner: 'Carol CSE' },
      { action: '' },
      { owner: 'Carol CSE', action: 'Step 2' },
      { owner: 'Carol CSE', action: 'Step 3' },
      { owner: 'Carol CSE', action: 'Step 4' },
      { owner: 'Carol CSE', action: 'Step 5 — should be dropped' },
    ]);
    const steps = parseCloseGapActionSteps(payload, SAMPLE_CTX);
    expect(steps).toHaveLength(MAX_CLOSE_GAP_STEPS);
    expect(steps!.map((s) => s.action)).toEqual([
      'Step 1',
      'Step 2',
      'Step 3',
      'Step 4',
    ]);
  });

  it('truncates overlong action text', () => {
    const longAction = 'A'.repeat(MAX_CLOSE_GAP_ACTION_CHARS + 40);
    const steps = parseCloseGapActionSteps(
      JSON.stringify([{ owner: 'Carol CSE', action: longAction }]),
      SAMPLE_CTX,
    );
    expect(steps![0]!.action.length).toBeLessThanOrEqual(
      MAX_CLOSE_GAP_ACTION_CHARS + 1,
    );
    expect(steps![0]!.action.endsWith('…')).toBe(true);
  });
});
