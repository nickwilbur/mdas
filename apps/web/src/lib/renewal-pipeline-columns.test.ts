import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_COLUMN_ORDER,
  DEFAULT_PIPELINE_COLUMN_WIDTHS,
  normalizePipelineColumnLayout,
  pipelineColumnLayoutSerializer,
  PIPELINE_COLUMN_MIN_WIDTH,
} from './renewal-pipeline-columns';

describe('normalizePipelineColumnLayout', () => {
  it('returns full default layout when input is null', () => {
    const layout = normalizePipelineColumnLayout(null);
    expect(layout.order).toEqual(DEFAULT_PIPELINE_COLUMN_ORDER);
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
  });

  it('deduplicates and appends missing columns', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['atr', 'atr', 'account', 'bogus' as never],
      widths: {},
    });
    expect(layout.order[0]).toBe('atr');
    expect(layout.order).toContain('account');
    expect(layout.order).toContain('customerEngagement');
    expect(layout.order.filter((id) => id === 'atr')).toHaveLength(1);
  });

  it('clamps widths below minimum back to defaults', () => {
    const layout = normalizePipelineColumnLayout({
      order: DEFAULT_PIPELINE_COLUMN_ORDER,
      widths: { account: PIPELINE_COLUMN_MIN_WIDTH - 1 },
    });
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
  });

  it('preserves valid custom widths', () => {
    const layout = normalizePipelineColumnLayout({
      order: DEFAULT_PIPELINE_COLUMN_ORDER,
      widths: { opportunity: 240 },
    });
    expect(layout.widths.opportunity).toBe(240);
  });
});

describe('pipelineColumnLayoutSerializer', () => {
  it('round-trips layout and repairs invalid stored order', () => {
    const restored = pipelineColumnLayoutSerializer.deserialize(
      JSON.stringify({
        order: ['atr', 'unknown'],
        widths: { atr: 12 },
      }),
    );
    expect(restored.order[0]).toBe('atr');
    expect(restored.order).toHaveLength(DEFAULT_PIPELINE_COLUMN_ORDER.length);
    expect(restored.order).toEqual(expect.arrayContaining(DEFAULT_PIPELINE_COLUMN_ORDER));
    expect(restored.widths.atr).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.atr);
  });
});
