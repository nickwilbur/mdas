import { describe, expect, it } from 'vitest';
import { applyTrajectoryPlan, overlayAuthoritativeTrajectoryKpis, parseRefreshTrajectoryKpis } from './forecast-trajectory-kpis.js';

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

describe('overlayAuthoritativeTrajectoryKpis', () => {
  const stale = {
    ...sampleKpi,
    flashUSD: -1_849_486,
    gapUSD: 314_514,
  };
  const fresh = {
    ...sampleKpi,
    flashUSD: -2_348_649,
    gapUSD: -184_649,
    planUSD: -2_164_000,
  };

  it('replaces the latest point on the same calendar day', () => {
    const trajectory = {
      asOfDate: '2026-05-01',
      currentQuarter: [
        {
          date: '2026-06-22',
          refreshId: 'old',
          refreshStartedAt: '2026-06-22T10:00:00.000Z',
          kpis: stale,
        },
        {
          date: '2026-06-25',
          refreshId: 'old',
          refreshStartedAt: '2026-06-25T15:36:38.535Z',
          kpis: stale,
        },
      ],
      nextQuarter: [],
    };
    const out = overlayAuthoritativeTrajectoryKpis(trajectory, fresh, {
      refreshId: 'new',
      refreshStartedAt: '2026-06-25T15:36:38.535Z',
    });
    expect(out.currentQuarter).toHaveLength(2);
    expect(out.currentQuarter[1]!.kpis.flashUSD).toBe(-2_348_649);
    expect(out.currentQuarter[0]!.kpis.flashUSD).toBe(-1_849_486);
  });

  it('appends when the authoritative day is new', () => {
    const trajectory = {
      asOfDate: '2026-05-01',
      currentQuarter: [
        {
          date: '2026-06-22',
          refreshId: 'old',
          refreshStartedAt: '2026-06-22T10:00:00.000Z',
          kpis: stale,
        },
      ],
      nextQuarter: [],
    };
    const out = overlayAuthoritativeTrajectoryKpis(trajectory, fresh, {
      refreshId: 'new',
      refreshStartedAt: '2026-06-25T15:36:38.535Z',
    });
    expect(out.currentQuarter).toHaveLength(2);
    expect(out.currentQuarter[1]!.kpis.flashUSD).toBe(-2_348_649);
  });
});
