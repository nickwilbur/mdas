import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PIPELINE_COLUMN_ORDER,
  DEFAULT_PIPELINE_COLUMN_WIDTHS,
  PIPELINE_COLUMN_MIN_WIDTH,
  normalizePipelineColumnLayout,
  pipelineColumnLayoutSerializer,
} from './renewal-pipeline-columns';

describe('normalizePipelineColumnLayout', () => {
  it('returns full default order when input is null', () => {
    const layout = normalizePipelineColumnLayout(null);
    expect(layout.order).toEqual(DEFAULT_PIPELINE_COLUMN_ORDER);
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
  });

  it('deduplicates custom order and appends any missing columns', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['atr', 'account', 'atr', 'bogus' as 'account'],
      widths: {},
    });
    expect(layout.order[0]).toBe('atr');
    expect(layout.order[1]).toBe('account');
    expect(layout.order).toHaveLength(DEFAULT_PIPELINE_COLUMN_ORDER.length);
    expect(new Set(layout.order).size).toBe(DEFAULT_PIPELINE_COLUMN_ORDER.length);
    for (const id of DEFAULT_PIPELINE_COLUMN_ORDER) {
      expect(layout.order).toContain(id);
    }
  });

  it('clamps widths below minimum back to defaults', () => {
    const layout = normalizePipelineColumnLayout({
      order: DEFAULT_PIPELINE_COLUMN_ORDER,
      widths: { account: 10, atr: PIPELINE_COLUMN_MIN_WIDTH },
    });
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
    expect(layout.widths.atr).toBe(PIPELINE_COLUMN_MIN_WIDTH);
  });

  it('preserves valid custom widths', () => {
    const layout = normalizePipelineColumnLayout({
      order: DEFAULT_PIPELINE_COLUMN_ORDER,
      widths: { account: 200 },
    });
    expect(layout.widths.account).toBe(200);
  });
});

describe('pipelineColumnLayoutSerializer', () => {
  it('round-trips normalized layout', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['atr', 'account'],
      widths: { account: 180 },
    });
    const restored = pipelineColumnLayoutSerializer.deserialize(
      pipelineColumnLayoutSerializer.serialize(layout),
    );
    expect(restored.order[0]).toBe('atr');
    expect(restored.order[1]).toBe('account');
    expect(restored.widths.account).toBe(180);
  });
});
