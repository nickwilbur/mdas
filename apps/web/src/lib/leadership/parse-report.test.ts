import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractLeadershipPosture,
  latestWeeklyReportSlug,
  parseLeadershipReport,
  parseMarkdownTable,
  splitLeadershipReportPages,
} from './parse-report';

const SAMPLE = `# Existing MDAS Weekly Leadership Report

**Reporting period:** June 20–26, 2026

# Page 1 — Overall Dashboard of Health

## Executive Summary
- **Material change:** Seven commits landed.

| **Overall status** | **Yellow** |

## Overall Health Dashboard

| Area | Status | Signal | Leadership Interpretation |
| Overall MDAS Health | **Yellow** | tests pass | CI red |

## Leadership Attention Needed

| Item | Why It Matters | Ask / Decision Needed | Owner | Needed By |
| CI failure | blocks merges | Fix deps | Engineering | Monday |

## Strategic Posture

| Field | Value |
| **Overall status** | **Yellow** |
| **Confidence** | **Medium** |

<div style="page-break-after: always;"></div>

# Page 2 — Details to Dig Into

## Strategic Alignment to CSE Goals

| CSE Priority | Weekly Progress | Evidence |
| 1. Manage portfolio | **Progress** | 8Q views |

# Page 3 — Recommendations and Focus Areas for Next Week

## Recommended Focus Areas for Next Week

| Priority | Intended Outcome |
| **1. Fix CI** | Green master |

## Closing Staff Engineer Assessment

- First closing point.
`;

describe('splitLeadershipReportPages', () => {
  it('splits markdown on Page N headers', () => {
    const pages = splitLeadershipReportPages(SAMPLE);
    expect(pages).toHaveLength(3);
    expect(pages[0]!.title).toBe('Overall Dashboard of Health');
  });
});

describe('parseLeadershipReport', () => {
  it('extracts structured dashboard data from weekly markdown', () => {
    const data = parseLeadershipReport(SAMPLE);
    expect(data.meta.reportingPeriod).toBe('June 20–26, 2026');
    expect(data.executiveSummary).toHaveLength(1);
    expect(data.executiveSummary[0]!.label).toBe('Material change');
    expect(data.healthAreas).toHaveLength(1);
    expect(data.healthAreas[0]!.status).toBe('Yellow');
    expect(data.leadershipAttention).toHaveLength(1);
    expect(data.strategicPosture.overallStatus).toBe('Yellow');
    expect(data.strategicAlignment.rows).toHaveLength(1);
    expect(data.focusAreas.rows).toHaveLength(1);
    expect(data.closingAssessment).toHaveLength(1);
  });
});

describe('parseMarkdownTable', () => {
  it('parses pipe tables and strips bold', () => {
    const table = parseMarkdownTable(`| A | B |\n| --- | --- |\n| **Yellow** | ok |`);
    expect(table?.rows[0]!.cells).toEqual(['Yellow', 'ok']);
  });
});

describe('extractLeadershipPosture', () => {
  it('reads reporting period and overall status', () => {
    const p = extractLeadershipPosture(SAMPLE);
    expect(p.reportingPeriod).toBe('June 20–26, 2026');
    expect(p.overallStatus).toBe('Yellow');
  });
});

describe('latestWeeklyReportSlug', () => {
  it('picks newest weekly-report slug', () => {
    expect(
      latestWeeklyReportSlug([
        { slug: 'weekly-report-2026-06-19' },
        { slug: 'weekly-report-2026-06-26' },
      ]),
    ).toBe('weekly-report-2026-06-26');
  });
});

describe('parseLeadershipReport integration', () => {
  it('parses the shipped weekly report file', () => {
    const path = resolve(process.cwd(), 'docs/leadership/weekly-report-2026-06-26.md');
    const md = readFileSync(path, 'utf-8');
    const data = parseLeadershipReport(md);
    expect(data.healthAreas.length).toBeGreaterThanOrEqual(8);
    expect(data.executiveSummary.length).toBeGreaterThanOrEqual(5);
    expect(data.focusAreas.rows.length).toBeGreaterThanOrEqual(4);
  });
});
