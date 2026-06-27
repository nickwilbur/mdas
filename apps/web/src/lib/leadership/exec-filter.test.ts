import { describe, expect, it } from 'vitest';
import { toExecDashboardData } from './exec-filter';
import { parseLeadershipReport } from './parse-report';

const ENGINEERING_SAMPLE = `# Report

# Page 1 — Portfolio Health Dashboard

## Executive Summary
- **CI failure:** master CI red

## Overall Health Dashboard

| Area | Status | Signal | Leadership Interpretation |
| Overall MDAS Health | **Yellow** | npm ci failed | Tooling broken |
| Near-Term Renewal Risk | **Red** | Antylia Jul 5 | Save motion needed |

## Leadership Attention Needed

| Item | Why It Matters | Ask / Decision Needed | Owner | Needed By |
| CI failure | blocks merges | Fix vitest | Engineering | Monday |
| CTA closure | 26 open | Weekly review | CSE Manager | Monday |

# Page 2 — Details

## Portfolio Data Confidence

| Indicator | Status |
| **CTA / ATR** | **Green** |

# Page 3 — Recommendations

## Closing CSE Leadership Assessment

- Business point only.
`;

describe('toExecDashboardData', () => {
  it('removes engineering and CI content from parsed report', () => {
    const filtered = toExecDashboardData(parseLeadershipReport(ENGINEERING_SAMPLE));
    expect(filtered.executiveSummary).toHaveLength(0);
    expect(filtered.healthAreas).toHaveLength(1);
    expect(filtered.healthAreas[0]!.area).toMatch(/Near-Term/);
    expect(filtered.leadershipAttention).toHaveLength(1);
    expect(filtered.leadershipAttention[0]!.item).toMatch(/CTA/);
  });
});
