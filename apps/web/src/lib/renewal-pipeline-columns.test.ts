import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_COLUMN_ORDER,
  DEFAULT_PIPELINE_COLUMN_WIDTHS,
  normalizePipelineColumnLayout,
  pipelineColumnLayoutSerializer,
  PIPELINE_COLUMN_MIN_WIDTH,
} from './renewal-pipeline-columns';

describe('normalizePipelineColumnLayout', () => {
  it('returns full default order when input is null', () => {
    const layout = normalizePipelineColumnLayout(null);
    expect(layout.order).toEqual(DEFAULT_PIPELINE_COLUMN_ORDER);
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
  });

  it('deduplicates and appends missing columns', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['atr', 'account', 'atr', 'stage'],
      widths: {},
    });
    expect(layout.order[0]).toBe('atr');
    expect(layout.order).toContain('customerEngagement');
    expect(layout.order.length).toBe(DEFAULT_PIPELINE_COLUMN_ORDER.length);
  });

  it('drops unknown column ids', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['account', 'not-real' as 'account'],
      widths: {},
    });
    expect(layout.order).not.toContain('not-real');
    expect(layout.order[0]).toBe('account');
  });

  it('clamps widths below the minimum back to defaults', () => {
    const layout = normalizePipelineColumnLayout({
      order: DEFAULT_PIPELINE_COLUMN_ORDER,
      widths: { account: 10, atr: 200 },
    });
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
    expect(layout.widths.atr).toBe(200);
    expect(PIPELINE_COLUMN_MIN_WIDTH).toBeGreaterThan(10);
  });
});

describe('pipelineColumnLayoutSerializer', () => {
  it('round-trips layout through JSON', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['account', 'atr'],
      widths: { account: 180 },
    });
    const restored = pipelineColumnLayoutSerializer.deserialize(
      pipelineColumnLayoutSerializer.serialize(layout),
    );
    expect(restored.order).toEqual(layout.order);
    expect(restored.widths.account).toBe(180);
  });
});
