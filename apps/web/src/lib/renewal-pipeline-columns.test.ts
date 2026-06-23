import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE_COLUMN_ORDER,
  DEFAULT_PIPELINE_COLUMN_WIDTHS,
  normalizePipelineColumnLayout,
  PIPELINE_COLUMN_MIN_WIDTH,
  pipelineColumnLayoutSerializer,
} from './renewal-pipeline-columns';

describe('normalizePipelineColumnLayout', () => {
  it('returns defaults when layout is null', () => {
    const layout = normalizePipelineColumnLayout(null);
    expect(layout.order).toEqual(DEFAULT_PIPELINE_COLUMN_ORDER);
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
  });

  it('dedupes order and drops unknown column ids', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['atr', 'bogus', 'atr', 'account'],
      widths: {},
    });
    expect(layout.order[0]).toBe('atr');
    expect(layout.order).toContain('account');
    expect(layout.order.filter((id) => id === 'atr')).toHaveLength(1);
    expect(layout.order).not.toContain('bogus' as never);
    expect(layout.order).toHaveLength(DEFAULT_PIPELINE_COLUMN_ORDER.length);
  });

  it('restores missing columns and enforces minimum widths', () => {
    const layout = normalizePipelineColumnLayout({
      order: ['account'],
      widths: { account: 10, atr: PIPELINE_COLUMN_MIN_WIDTH - 1 },
    });
    expect(layout.order).toEqual(DEFAULT_PIPELINE_COLUMN_ORDER);
    expect(layout.widths.account).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.account);
    expect(layout.widths.atr).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.atr);
  });
});

describe('pipelineColumnLayoutSerializer', () => {
  it('round-trips and sanitizes partial layouts', () => {
    const raw = { order: ['stage', 'stage', 'unknown'], widths: { stage: 40 } };
    const restored = pipelineColumnLayoutSerializer.deserialize(
      pipelineColumnLayoutSerializer.serialize(raw as never),
    );
    expect(restored.order[0]).toBe('stage');
    expect(restored.order).toHaveLength(DEFAULT_PIPELINE_COLUMN_ORDER.length);
    expect(restored.order).not.toContain('unknown' as never);
    expect(restored.widths.stage).toBe(DEFAULT_PIPELINE_COLUMN_WIDTHS.stage);
  });
});
