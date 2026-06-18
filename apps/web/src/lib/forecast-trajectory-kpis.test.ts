import { describe, expect, it } from 'vitest';
import { applyTrajectoryPlan, parseRefreshTrajectoryKpis } from './forecast-trajectory-kpis.js';

const sampleKpi = {
  fiscalQuarterKey: 'FY27Q2',
  fiscalQuarterLabel: 'FY27 Q2',
  planUSD: null,
  flashUSD: -1000,
  gapUSD: null,
  totalRiskUSD: -2000,
  hedgeUSD: 500,
  redAccountCount: 1,
  yellowAccountCount: 2,
  accountCount: 10,
  opportunityCount: 12,
};

describe('parseRefreshTrajectoryKpis', () => {
  it('accepts valid stored payload', () => {
    const parsed = parseRefreshTrajectoryKpis({
      asOfDate: '2026-06-16',
      current: sampleKpi,
      next: { ...sampleKpi, fiscalQuarterKey: 'FY27Q3' },
    });
    expect(parsed?.asOfDate).toBe('2026-06-16');
    expect(parsed?.current.flashUSD).toBe(-1000);
  });

  it('rejects malformed payload', () => {
    expect(parseRefreshTrajectoryKpis(null)).toBeNull();
    expect(parseRefreshTrajectoryKpis({ asOfDate: 'x' })).toBeNull();
  });
});

describe('applyTrajectoryPlan', () => {
  it('fills plan and gap when plan is provided', () => {
    const out = applyTrajectoryPlan(sampleKpi, -5000);
    expect(out.planUSD).toBe(-5000);
    expect(out.gapUSD).toBe(-1000 - -5000);
  });

  it('leaves kpis unchanged when plan is null', () => {
    expect(applyTrajectoryPlan(sampleKpi, null)).toEqual(sampleKpi);
  });
});
