import { describe, expect, it } from 'vitest';
import {
  flashToPlanPct,
  formatGapToPlan,
  grrMeetsInternalGoal,
  planPerformancePctLabel,
  planPerformanceTone,
} from './forecast-plan-kpi';

describe('forecast-plan-kpi', () => {
  it('grrMeetsInternalGoal uses 75% threshold', () => {
    expect(grrMeetsInternalGoal(0.75)).toBe(true);
    expect(grrMeetsInternalGoal(0.749)).toBe(false);
    expect(grrMeetsInternalGoal(null)).toBe(false);
  });

  it('flashToPlanPct matches forecast generator convention', () => {
    expect(flashToPlanPct(-2_435_022, -2_164_000)).toBeCloseTo(112.5, 0);
    expect(flashToPlanPct(-1_800_000, -2_164_000)).toBeCloseTo(83.2, 0);
  });

  it('formatGapToPlan renders over/under plan', () => {
    expect(formatGapToPlan(-2_435_022, -2_164_000)).toMatch(/113% over plan/);
    expect(formatGapToPlan(-1_800_000, -2_164_000)).toMatch(/83% under plan/);
    expect(formatGapToPlan(-2_164_000, -2_164_000)).toContain('at plan');
  });

  it('planPerformanceTone: under plan green, over plan yellow', () => {
    expect(planPerformanceTone(-1_800_000, -2_164_000)).toBe('green');
    expect(planPerformanceTone(-2_435_022, -2_164_000)).toBe('yellow');
    expect(planPerformanceTone(-2_164_000, -2_164_000)).toBe('green');
  });

  it('planPerformancePctLabel', () => {
    expect(planPerformancePctLabel(-1_800_000, -2_164_000)).toBe('83% under plan');
    expect(planPerformancePctLabel(-2_435_022, -2_164_000)).toBe('113% over plan');
  });
});
