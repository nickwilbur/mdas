import { describe, expect, it } from 'vitest';
import {
  isFullChurnForecast,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_ORDER,
  prospectivePipelineStatus,
  resolvePipelineStatus,
} from '@mdas/renewal-metrics';

describe('isFullChurnForecast', () => {
  it('returns false when ATR is zero', () => {
    expect(isFullChurnForecast({ atrUSD: 0, downsellAmountUSD: 0, renewedRevenueUSD: 0 })).toBe(false);
  });

  it('returns true when downsell equals ATR', () => {
    expect(
      isFullChurnForecast({ atrUSD: 100_000, downsellAmountUSD: 100_000, renewedRevenueUSD: 0 }),
    ).toBe(true);
  });

  it('returns true when renewed revenue is zero with positive ATR', () => {
    expect(
      isFullChurnForecast({ atrUSD: 100_000, downsellAmountUSD: 50_000, renewedRevenueUSD: 0 }),
    ).toBe(true);
  });

  it('returns false for partial downsell with renewed revenue', () => {
    expect(
      isFullChurnForecast({ atrUSD: 100_000, downsellAmountUSD: 25_000, renewedRevenueUSD: 75_000 }),
    ).toBe(false);
  });
});

describe('resolvePipelineStatus', () => {
  it('maps pushed outcome', () => {
    expect(
      resolvePipelineStatus({
        outcome: 'pushed',
        atrUSD: 100_000,
        renewedRevenueUSD: 50_000,
        downsellAmountUSD: 50_000,
      }),
    ).toEqual({ key: 'pushed', label: PIPELINE_STATUS_LABELS.pushed });
  });

  it('maps open full-churn forecast before partial downsell forecast', () => {
    expect(
      resolvePipelineStatus({
        outcome: 'pending',
        atrUSD: 100_000,
        renewedRevenueUSD: 0,
        downsellAmountUSD: 100_000,
      }),
    ).toEqual({ key: 'forecast_full_churn', label: 'Forecast full churn' });
  });

  it('maps open partial downsell forecast', () => {
    expect(
      resolvePipelineStatus({
        outcome: 'pending',
        atrUSD: 100_000,
        renewedRevenueUSD: 75_000,
        downsellAmountUSD: 25_000,
      }),
    ).toEqual({ key: 'forecast_downsell', label: PIPELINE_STATUS_LABELS.forecast_downsell });
  });

  it('maps open expansion forecast', () => {
    expect(
      resolvePipelineStatus({
        outcome: 'pending',
        atrUSD: 100_000,
        renewedRevenueUSD: 120_000,
        downsellAmountUSD: 0,
      }),
    ).toEqual({ key: 'forecast_expansion', label: PIPELINE_STATUS_LABELS.forecast_expansion });
  });

  it('maps plain open renewal', () => {
    expect(
      resolvePipelineStatus({
        outcome: 'pending',
        atrUSD: 100_000,
        renewedRevenueUSD: 100_000,
        downsellAmountUSD: 0,
      }),
    ).toEqual({ key: 'open', label: PIPELINE_STATUS_LABELS.open });
  });

  it('maps closed outcomes to matching keys', () => {
    expect(
      resolvePipelineStatus({
        outcome: 'full_churn',
        atrUSD: 100_000,
        renewedRevenueUSD: 0,
        downsellAmountUSD: 100_000,
      }),
    ).toEqual({ key: 'full_churn', label: PIPELINE_STATUS_LABELS.full_churn });
  });
});

describe('prospectivePipelineStatus', () => {
  it('derives full churn label for pending 100% loss', () => {
    expect(
      prospectivePipelineStatus('pending', {
        atrUSD: 100_000,
        renewedRevenueUSD: 0,
        downsellAmountUSD: 100_000,
      }),
    ).toBe('Forecast full churn');
  });

  it('returns closed labels for terminal outcomes', () => {
    expect(prospectivePipelineStatus('flat')).toBe(PIPELINE_STATUS_LABELS.flat);
    expect(prospectivePipelineStatus('expanded')).toBe(PIPELINE_STATUS_LABELS.expanded);
  });
});

describe('PIPELINE_STATUS_ORDER', () => {
  it('lists every defined status key once', () => {
    const labels = Object.keys(PIPELINE_STATUS_LABELS);
    expect(PIPELINE_STATUS_ORDER).toHaveLength(labels.length);
    for (const key of labels) {
      expect(PIPELINE_STATUS_ORDER).toContain(key);
    }
  });
});
