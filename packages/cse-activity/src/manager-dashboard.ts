import type { WeeklySnapshot, NormalizedActivity } from './types.js';
import { formatReportingPeriod } from './format.js';
import { dedupeTeamMetrics } from './metrics.js';
import { classifyFromMdasSignal } from './classify.js';

function normalizeStoredActivity(activity: NormalizedActivity): NormalizedActivity {
  if (!activity.id.startsWith('mdas-change-')) return activity;
  const [categoryPart, fieldPart] = activity.title.includes(':')
    ? activity.title.split(':', 2).map((part) => part.trim())
    : [activity.title, ''];
  return {
    ...activity,
    ...classifyFromMdasSignal({
      kind: 'change_event',
      title: categoryPart ?? '',
      summary: activity.summary,
      field: fieldPart ?? '',
      changeCategory: categoryPart ?? '',
    }),
  };
}

function refreshedDerivedCounts(snapshot: WeeklySnapshot) {
  const activities = snapshot.teamActivity.map(normalizeStoredActivity);
  const customerFacingAccounts = new Set(
    activities.filter((a) => a.customerFacing && a.accountId).map((a) => a.accountId),
  ).size;
  const internalOnlyAccounts = snapshot.accountMetrics.filter((a) => {
    const acts = activities.filter((act) => act.accountId === a.accountId);
    return acts.length > 0 && !acts.some((act) => act.customerFacing);
  }).length;
  return {
    activities,
    customerFacingAccounts,
    internalOnlyAccounts,
    customerFacingActivities: activities.filter((a) => a.customerFacing).length,
  };
}

function statusRow(
  area: string,
  status: string,
  signal: string,
  interpretation: string,
): string {
  return `| ${area} | ${status} | ${signal} | ${interpretation} |`;
}

export function generateManagerDashboard(snapshot: WeeklySnapshot): string {
  const m = snapshot.metadata;
  const d = m.derivedMetrics;
  const refreshed = refreshedDerivedCounts(snapshot);
  const period = formatReportingPeriod(m.reportingWindowStart, m.reportingWindowEnd, m.timezone);

  const execBullets = [
    `- **Team activity health:** ${m.overallStatus} posture (${m.strategicPosture}) with ${snapshot.teamActivity.length} classified activities from connected sources.`,
    `- **Strategic progress:** ${refreshed.customerFacingAccounts} accounts with customer-facing motion; ${d.accountPlansUpdated} account-planning signals.`,
    `- **Renewal-risk coverage:** ${d.highValueRenewalRisksWithActivity} high-value risks with activity; **${d.highValueRenewalRisksWithoutActivity} appear under-covered** (no evidence in window — not proof of inactivity).`,
    `- **Health signal usage:** ${d.healthSignalsReviewed} health-signal reviews; ${d.healthSignalsActedOn} renewal-risk motions tied to signals.`,
    `- **Executive engagement:** ${d.accountsWithExecutiveEngagement} executive-engagement activities observed.`,
    `- **AI adoption:** ${d.teamMembersUsingAi} team members with AI workflow signals; ${d.aiArtifactsCreated} AI-assisted artifacts.`,
    `- **Manager attention next week:** Prioritize under-covered renewal risks and coach customer-facing follow-through where only internal motion was observed.`,
  ];

  const healthTable = [
    statusRow(
      'Overall Team Activity',
      m.overallStatus,
      `${snapshot.teamActivity.length} activities`,
      'Volume is supporting context only — interpret strategic coverage, not busyness.',
    ),
    statusRow(
      'Customer-Facing Engagement',
      refreshed.customerFacingAccounts >= 3 ? 'Green' : refreshed.customerFacingAccounts > 0 ? 'Yellow' : 'Red',
      `${refreshed.customerFacingAccounts} accounts`,
      refreshed.customerFacingAccounts > 0
        ? 'Customer motion present on connected sources.'
        : 'No customer-facing evidence — verify source coverage before coaching.',
    ),
    statusRow(
      'High-Value Renewal Risk Coverage',
      d.highValueRenewalRisksWithoutActivity <= 2 ? 'Green' : d.highValueRenewalRisksWithoutActivity <= 5 ? 'Yellow' : 'Red',
      `${d.highValueRenewalRisksWithActivity} covered / ${d.highValueRenewalRisksWithoutActivity} under-covered`,
      'Under-covered means no evidence in window, not confirmed inactivity.',
    ),
    statusRow(
      'ATR Retention Motion',
      d.healthSignalsActedOn > 0 ? 'Yellow' : 'Red',
      `${d.healthSignalsActedOn} renewal-risk motions`,
      'Supports retention prioritization; outcome measurement not in v1.',
    ),
    statusRow(
      'Expand 3 Portfolio Motion',
      d.accountPlansUpdated > 0 || refreshed.customerFacingAccounts > 0 ? 'Yellow' : 'Red',
      `${d.accountPlansUpdated} planning signals`,
      'Forward portfolio work should increase 6–8 quarter visibility.',
    ),
    statusRow(
      'Health Signal Usage',
      d.healthSignalsReviewed > 0 ? 'Yellow' : 'Red',
      `${d.healthSignalsReviewed} reviews`,
      'Systematic signal usage still maturing.',
    ),
    statusRow(
      'Executive Engagement',
      d.accountsWithExecutiveEngagement > 0 ? 'Yellow' : 'Red',
      `${d.accountsWithExecutiveEngagement} activities`,
      'Escalate earlier on saveable risks lacking exec motion.',
    ),
    statusRow(
      'Account Activity Visibility',
      m.dataCoverage === 'Strong' ? 'Green' : m.dataCoverage === 'Partial' ? 'Yellow' : 'Red',
      m.dataCoverage,
      'Depends on connected source coverage.',
    ),
    statusRow(
      'Strategic Customer Engagement',
      refreshed.customerFacingAccounts >= refreshed.internalOnlyAccounts ? 'Yellow' : 'Red',
      `${refreshed.customerFacingAccounts} customer / ${refreshed.internalOnlyAccounts} internal-only`,
      'Coach toward strategic customer outcomes, not internal chatter.',
    ),
    statusRow(
      'AI Adoption / Enablement',
      d.teamMembersUsingAi > 0 ? 'Yellow' : 'Red',
      `${d.teamMembersUsingAi} members`,
      'Hands-on enablement opportunity where absent.',
    ),
    statusRow(
      'Follow-through / Next Steps',
      d.followUpsCreatedOrCompleted > 0 ? 'Yellow' : 'Red',
      `${d.followUpsCreatedOrCompleted} follow-ups`,
      `${d.accountsStaleNextSteps} accounts with stale/missing next-step evidence.`,
    ),
  ].join('\n');

  const teamTable = dedupeTeamMetrics(snapshot.teamMetrics)
    .map((t) => {
      const memberActs = refreshed.activities.filter(
        (a) => a.teamMemberName?.toLowerCase() === t.teamMemberName.toLowerCase(),
      );
      const customerFacing = memberActs.filter((a) => a.customerFacing).length;
      const strategicInternal = memberActs.filter(
        (a) => !a.customerFacing && a.category !== 'administrative',
      ).length;
      return `| ${t.teamMemberName} | ${t.dataAvailable ? customerFacing : 'Data not available'} | ${t.dataAvailable ? strategicInternal : 'Data not available'} | ${t.dataAvailable ? t.highValueAccountsTouched : '—'} | ${t.dataAvailable ? t.renewalRisksTouched : '—'} | ${t.dataAvailable ? t.executiveEngagementCount : '—'} | ${t.aiUsageSignal} | ${t.managerNote} |`;
    })
    .join('\n');

  const accountTable = snapshot.accountMetrics
    .slice(0, 25)
    .map(
      (a) =>
        `| ${a.accountName} | ${a.ownerName ?? '—'} | ${a.healthRiskSignal} | ${a.activityThisWeek} | ${a.strategicMotion} | ${a.gapConcern} | ${a.recommendedManagerAction} |`,
    )
    .join('\n');

  const renewalRows = snapshot.accountMetrics
    .filter((a) => a.bucket === 'Saveable Risk' || a.bucket === 'Confirmed Churn')
    .slice(0, 15)
    .map(
      (a) =>
        `| ${a.accountName} | ${a.bucket} / $${Math.round(a.atrUsd).toLocaleString()} | ${a.healthRiskSignal} | ${a.activityThisWeek} | ${a.customerFacing ? 'Some customer motion' : 'No exec evidence in window'} | ${a.recommendedManagerAction} |`,
    )
    .join('\n');

  const coverageTable = snapshot.sourceCoverage
    .map((s) => `| ${s.source} | ${s.status} | ${s.notes} | ${s.impactOfGap} |`)
    .join('\n');

  return `# Weekly CSE Activity Dashboard

Reporting period: ${period}  
Snapshot date: ${m.snapshotDate}  
Prepared for: CSE Manager  
Timezone: ${m.timezone}

## 1. Executive Manager Summary

${execBullets.join('\n')}

- **Overall team status:** ${m.overallStatus}
- **Strategic posture:** ${m.strategicPosture}
- **Confidence level:** ${m.confidenceLevel}
- **Data coverage:** ${m.dataCoverage}

## 2. Team Activity Health Dashboard

| Area | Status | Signal | Manager Interpretation |
| -------------------------------- | -------------------- | ---------- | ---------------------- |
${healthTable}

## 3. Team Activity Snapshot

| Team Member | Customer-Facing Activity | Strategic / Internal Activity | High-Value Accounts Touched | Renewal Risks Touched | Executive Engagement | AI Usage Signal | Manager Note |
| ----------- | -----------------------: | ----------------------------: | --------------------------- | --------------------- | -------------------- | --------------- | ------------ |
${teamTable}

## 4. Account and Portfolio Coverage

| Account / Segment | Owner | Health / Risk Signal | Activity This Week | Strategic Motion | Gap / Concern | Recommended Manager Action |
| ----------------- | ----- | -------------------- | ------------------ | ---------------- | ------------- | -------------------------- |
${accountTable}

## 5. Renewal Risk and Executive Engagement Review

| Renewal Risk / Account | Value / Priority | Current Signal | Activity This Week | Executive Engagement Status | Recommended Next Step |
| ---------------------- | ---------------- | -------------- | ------------------ | --------------------------- | --------------------- |
${renewalRows || '| — | — | — | No renewal-risk accounts in scope | — | — |'}

## 6. Health Signal Usage

- **Reviewed/acted:** ${d.healthSignalsReviewed} signal reviews; ${d.healthSignalsActedOn} renewal motions.
- **Stale/missing:** ${d.accountsStaleNextSteps} accounts with no in-window evidence on connected sources.
- **Portfolio prioritization:** Use health + renewal workbench together for 6–8 quarter rhythm.

| Signal | Accounts Affected | Action Taken | Gap | Recommendation |
| ------ | ----------------- | ------------ | --- | -------------- |
| CSE sentiment / risk movement | ${d.healthSignalsReviewed} | ${d.healthSignalsActedOn} renewal motions | Partial source coverage | Validate top risks in MDAS renewal views |

## 7. AI Adoption and Enablement

| AI Use Case | Observed Usage | Opportunity | Recommended Enablement |
| ----------- | -------------- | ----------- | ---------------------- |
| Account activity summary | ${d.aiArtifactsCreated > 0 ? 'Some' : 'No direct evidence'} | Weekly account briefs before customer calls | Pair with Glean / MDAS drill-in |
| Renewal-risk brief | CTA + MDAS signals | Pre-exec renewal prep | Use renewal workbench + CTA board |
| Manager coaching notes | Snapshot reports | Individual reflections | Send team-member weekly reports |

## 8. Manager Coaching Opportunities

| Coaching Theme | Evidence | Suggested Coaching Question | Suggested Manager Action |
| -------------- | -------- | --------------------------- | ------------------------ |
| Customer-facing follow-through | ${refreshed.internalOnlyAccounts} accounts internal-only | What customer next step follows this internal thread? | Review 2 accounts in 1:1 |
| Renewal-risk coverage | ${d.highValueRenewalRisksWithoutActivity} under-covered risks | Which exec sponsor should we engage earlier? | Prioritize in weekly risk review |
| Health signal usage | ${d.healthSignalsReviewed} reviews | How are you using signals to reorder your week? | Model portfolio triage in team meeting |

## 9. Recommended Manager Focus for Next Week

| Priority | Why It Matters | Team / Account Scope | Suggested Action | Success Signal |
| -------- | -------------- | -------------------- | ---------------- | -------------- |
| Close renewal-risk coverage gaps | ATR retention | Under-covered saveable risks | Manager-led inspection of top 5 | Evidence of customer or exec motion |
| Expand 3 portfolio rhythm | 6–8 quarter planning | Strategic accounts | Use renewal workbench prospective bucket | Account plans updated |
| AI hands-on enablement | Adoption goal | Team | Demo account brief workflow in team sync | 2+ members try workflow |

## 10. Data Coverage and Gaps

| Source | Status | Coverage Notes | Impact of Gap |
| ------ | ------ | -------------- | ------------- |
${coverageTable}

---
*This dashboard is for internal manager coaching. It is not a productivity leaderboard. Missing data is labeled explicitly.*
`;
}
