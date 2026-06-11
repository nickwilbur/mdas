import { describe, expect, it } from 'vitest';
import { parseForecastStreamLines } from './forecast-stream';

describe('parseForecastStreamLines', () => {
  it('parses progress and done events from NDJSON lines', () => {
    const lines = [
      '{"type":"progress","step":"data","label":"Loading…","pct":8}',
      '{"type":"done","text":"script","asOfDate":"2026-05-01"}',
    ];
    const out = parseForecastStreamLines(lines);
    expect(out.progress).toEqual([
      { step: 'data', label: 'Loading…', pct: 8 },
    ]);
    expect(out.done).toEqual({ text: 'script', asOfDate: '2026-05-01' });
    expect(out.error).toBeNull();
  });

  it('captures error events', () => {
    const out = parseForecastStreamLines([
      '{"type":"error","error":"Failed","detail":"timeout"}',
    ]);
    expect(out.error).toEqual({ error: 'Failed', detail: 'timeout' });
    expect(out.done).toBeNull();
  });
});
