import type {
  AttentionRow,
  HealthAreaRow,
  LabeledBullet,
  LeadershipReportData,
  ParsedTable,
} from './parse-report';

const ENGINEERING_PATTERNS =
  /\b(CI\b|npm|vitest|commit|master|github actions|MDAS health|engineering delivery|operational \/ supportability|refresh perf|structured json|peer-dependency|e2e\/lighthouse|tooling works locally)\b/i;

const ENGINEERING_AREA =
  /^(overall mdas health|engineering delivery|operational \/ supportability)/i;

function filterBullets(bullets: LabeledBullet[]): LabeledBullet[] {
  return bullets.filter((b) => !ENGINEERING_PATTERNS.test(`${b.label} ${b.body}`));
}

function filterHealthAreas(rows: HealthAreaRow[]): HealthAreaRow[] {
  return rows.filter(
    (r) =>
      !ENGINEERING_AREA.test(r.area) &&
      !ENGINEERING_PATTERNS.test(`${r.area} ${r.signal} ${r.interpretation}`),
  );
}

function filterAttention(rows: AttentionRow[]): AttentionRow[] {
  return rows.filter(
    (r) => !ENGINEERING_PATTERNS.test(`${r.item} ${r.why} ${r.ask} ${r.owner}`),
  );
}

function filterTableRows(table: ParsedTable): ParsedTable {
  return {
    headers: table.headers,
    rows: table.rows.filter((r) => !ENGINEERING_PATTERNS.test(r.cells.join(' '))),
  };
}

/** Strip engineering / tooling content — exec dashboard is for CSE business outcomes. */
export function toExecDashboardData(data: LeadershipReportData): LeadershipReportData {
  const staffAssessment =
    data.strategicPosture.staffAssessment?.replace(/^MDAS is building/i, 'The portfolio program is building') ??
    data.strategicPosture.staffAssessment;

  return {
    ...data,
    meta: {
      ...data.meta,
      title: data.meta.title.replace(/Existing MDAS/i, 'Expand 3 CSE').trim(),
    },
    executiveSummary: filterBullets(data.executiveSummary),
    healthAreas: filterHealthAreas(data.healthAreas),
    leadershipAttention: filterAttention(data.leadershipAttention),
    strategicAlignment: filterTableRows(data.strategicAlignment),
    outcomesDelivered: filterTableRows(data.outcomesDelivered),
    workInProgress: filterTableRows(data.workInProgress),
    engineeringHealth: filterTableRows(data.engineeringHealth),
    focusAreas: filterTableRows(data.focusAreas),
    staffRecommendations: filterTableRows(data.staffRecommendations),
    risks: filterTableRows(data.risks),
    closingAssessment: data.closingAssessment.filter((c) => !ENGINEERING_PATTERNS.test(c)),
    strategicPosture: {
      ...data.strategicPosture,
      staffAssessment,
      primaryAttention: data.strategicPosture.primaryAttention?.replace(
        /restore CI/i,
        'close top save motions',
      ),
    },
    footnote: data.footnote?.replace(/master commits|GitHub Actions[^,]*,?\s*/gi, ''),
  };
}
