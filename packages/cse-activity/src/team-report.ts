import type { CseActivityConfig, NormalizedActivity, WeeklySnapshot } from './types.js';
import { formatReportingPeriod } from './format.js';
import { dedupeTeamMembers } from './infer-config.js';

const CSE_GOALS = [
  'ATR retention improvement',
  'Expand 3 portfolio management',
  'Health signal usage',
  'Renewal risk prioritization',
  'Executive engagement',
  'Account activity visibility',
  'AI adoption / enablement',
] as const;

function goalActivity(
  goal: string,
  memberActs: NormalizedActivity[],
): { activity: string; observation: string } {
  switch (goal) {
    case 'ATR retention improvement':
      return {
        activity:
          memberActs.filter((a) => a.strategicTags.includes('atr_retention')).length > 0
            ? `${memberActs.filter((a) => a.strategicTags.includes('atr_retention')).length} retention-tagged activities`
            : 'No direct evidence in connected sources',
        observation: 'Supports save motions; retention outcome not measured here.',
      };
    case 'Expand 3 portfolio management':
      return {
        activity:
          memberActs.filter((a) => a.strategicTags.includes('expand3_portfolio')).length > 0
            ? 'Portfolio-tagged motion observed'
            : 'No direct evidence in connected sources',
        observation: 'Forward portfolio visibility depends on account planning cadence.',
      };
    case 'Health signal usage':
      return {
        activity:
          memberActs.filter((a) => a.category === 'health_signal_review').length > 0
            ? 'Health signal reviews observed'
            : 'No direct evidence in connected sources',
        observation: 'Use MDAS risk/sentiment changes to prioritize outreach.',
      };
    case 'Renewal risk prioritization':
      return {
        activity:
          memberActs.filter((a) => a.category === 'renewal_risk_activity').length > 0
            ? `${memberActs.filter((a) => a.category === 'renewal_risk_activity').length} renewal-risk activities`
            : 'No direct evidence in connected sources',
        observation: 'Pair CTA board with customer-facing follow-through.',
      };
    case 'Executive engagement':
      return {
        activity:
          memberActs.filter((a) => a.category === 'executive_engagement').length > 0
            ? 'Executive engagement observed'
            : 'No direct evidence in connected sources',
        observation: 'Consider earlier exec alignment on at-risk renewals.',
      };
    case 'Account activity visibility':
      return {
        activity:
          memberActs.length > 0
            ? `${memberActs.length} classified activities`
            : 'Data not available',
        observation:
          memberActs.length > 0
            ? 'Activity visible on connected sources.'
            : 'Missing data — not proof of no work.',
      };
    case 'AI adoption / enablement':
      return {
        activity:
          memberActs.some((a) => a.category === 'ai_assisted_workflow')
            ? 'AI-assisted workflow observed'
            : 'No direct evidence in connected sources',
        observation: 'Try account brief workflow before customer meetings.',
      };
    default:
      return { activity: '—', observation: '—' };
  }
}

export function generateTeamMemberReport(
  snapshot: WeeklySnapshot,
  config: CseActivityConfig,
  memberName: string,
): string {
  const member = config.teamMembers.find((m) => m.name === memberName);
  const metrics = snapshot.teamMetrics.find((t) => t.teamMemberName === memberName);
  const memberActs = snapshot.teamActivity.filter(
    (a) => a.teamMemberName?.toLowerCase() === memberName.toLowerCase(),
  );
  const m = snapshot.metadata;
  const period = formatReportingPeriod(m.reportingWindowStart, m.reportingWindowEnd, m.timezone);

  const highlights: string[] = [];
  if (memberActs.some((a) => a.customerFacing)) {
    highlights.push('- Customer-facing engagement recorded on connected sources this week.');
  }
  if (memberActs.some((a) => a.category === 'renewal_risk_activity')) {
    highlights.push('- Renewal-risk portfolio motion observed — supports retention prioritization.');
  }
  if (memberActs.some((a) => a.category === 'executive_engagement')) {
    highlights.push('- Executive-level customer engagement in the reporting window.');
  }
  if (highlights.length === 0) {
    highlights.push(
      '- **Data not available** on all configured sources for this window — this is not a statement about your effort.',
    );
  }

  const goalTable = CSE_GOALS.map((g) => {
    const { activity, observation } = goalActivity(g, memberActs);
    return `| ${g} | ${activity} | ${observation} |`;
  }).join('\n');

  const accountIds = [...new Set(memberActs.map((a) => a.accountId).filter(Boolean))];
  const accountRows =
    accountIds.length > 0
      ? accountIds
          .slice(0, 12)
          .map((id) => {
            const acts = memberActs.filter((a) => a.accountId === id);
            const name = acts[0]?.accountName ?? id;
            return `| ${name} | ${acts.map((a) => a.title).join('; ')} | ${acts[0]?.category ?? '—'} | Review next-step clarity with manager |`;
          })
          .join('\n')
      : '| — | Data not available on connected sources | — | Confirm account priorities for next week |';

  const coaching: string[] = [];
  if (metrics && !metrics.dataAvailable) {
    coaching.push(
      '- Source coverage was incomplete this week — let’s align on which systems should feed your activity narrative.',
    );
  } else if (metrics && metrics.customerFacingCount === 0 && metrics.strategicInternalCount > 0) {
    coaching.push(
      '- One opportunity next week is converting internal portfolio motion into a customer-facing touch on your top renewal-risk account.',
    );
  } else {
    coaching.push('- A useful next step may be documenting clear next steps after each customer interaction.');
  }
  coaching.push('- Consider using health signals in MDAS to reorder Monday priorities toward at-risk renewals.');

  const highlightForNote =
    memberActs[0]?.title ?? metrics?.managerNote ?? 'portfolio coverage this week';

  return `# Weekly CSE Activity Reflection

Team member: ${memberName}  
Reporting period: ${period}  
Prepared by: ${config.managerName}

## 1. Highlights From This Week

${highlights.join('\n')}

## 2. Strategic Alignment

| CSE Goal | Your Activity This Week | Impact / Observation |
| ----------------------------- | -------------------------------- | -------------------- |
${goalTable}

## 3. Accounts and Customer Motion

| Account | Activity This Week | Strategic Signal | Suggested Follow-up |
| ------- | ------------------ | ---------------- | ------------------- |
${accountRows}

## 4. Coaching Reflection

${coaching.join('\n')}

## 5. Suggested Focus for Next Week

| Focus Area | Why It Matters | Suggested Action | Success Signal |
| ---------- | -------------- | ---------------- | -------------- |
| Customer-facing follow-through | Retention + visibility | Schedule outreach on top renewal-risk account | Documented customer touch |
| Health signal usage | Portfolio prioritization | Review MDAS WoW + sentiment changes Monday | Prioritized account list |

## 6. Suggested AI Enablement

**Suggested AI workflow:** Account activity brief before customer calls

**How to use it:** Pull MDAS drill-in + Glean search for the account; draft a 5-bullet brief with risks, recent motion, and proposed next step.

**Why it helps:** Reduces prep time and improves strategic customer conversations.

**Success signal:** Brief shared in account channel or attached to CRM note before meeting.

## 7. Manager Note

Thanks for the work this week on **${highlightForNote}**. Next week, I'd like us to focus on **customer-facing follow-through on renewal-risk accounts** because it supports our ATR retention and Expand 3 portfolio goals. Let's use our 1:1 to talk through **health-signal prioritization** and any blockers.

---
*This reflection is coaching-oriented, not a performance ranking.*
`;
}

export function generateAllTeamReports(
  snapshot: WeeklySnapshot,
  config: CseActivityConfig,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const member of dedupeTeamMembers(config.teamMembers).filter((m) => m.active !== false)) {
    out[member.name] = generateTeamMemberReport(snapshot, config, member.name);
  }
  return out;
}
