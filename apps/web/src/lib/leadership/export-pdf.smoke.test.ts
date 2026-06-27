import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLeadershipBriefDoc, sanitizeText } from './export-pdf';
import { toExecDashboardData } from './exec-filter';
import { parseLeadershipReport } from './parse-report';

describe('buildLeadershipBriefDoc', () => {
  it('renders the real weekly report into a clean multi-page PDF without throwing', async () => {
    const md = readFileSync(
      new URL('../../../../../docs/leadership/weekly-report-2026-06-26.md', import.meta.url),
      'utf8',
    );
    const data = toExecDashboardData(parseLeadershipReport(md));
    const doc = await buildLeadershipBriefDoc(data);
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(5);
    const buf = Buffer.from(doc.output('arraybuffer'));
    expect(buf.length).toBeGreaterThan(2000);
  });
});

describe('sanitizeText', () => {
  it('maps non-WinAnsi glyphs that break jsPDF text measurement', () => {
    expect(sanitizeText('Renewal Risk (≤90 days)')).toBe('Renewal Risk (<=90 days)');
    expect(sanitizeText('prioritization ≠ action')).toBe('prioritization != action');
    expect(sanitizeText('open ATR ≈ $3.7M')).toBe('open ATR ~ $3.7M');
    expect(sanitizeText('see → next')).toBe('see -> next');
    expect(sanitizeText('**bold** and `code`')).toBe('bold and code');
  });
});
