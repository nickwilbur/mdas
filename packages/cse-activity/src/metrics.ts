import type {
  AccountWeekMetrics,
  CseActivityConfig,
  DerivedWeekMetrics,
  NormalizedActivity,
  SnapshotMetadata,
  TeamMemberWeekMetrics,
  TrafficStatus,
} from './types.js';
import type { AccountView } from '@mdas/canonical';
import { dedupeTeamMembers, isSyntheticCseId } from './infer-config.js';

function activityMatchesMember(activity: NormalizedActivity, member: { name: string; mdasCseId?: string | null }): boolean {
  if (activity.teamMemberName?.toLowerCase() === member.name.toLowerCase()) return true;
  if (
    member.mdasCseId &&
    !isSyntheticCseId(member.mdasCseId) &&
    activity.teamMemberId === member.mdasCseId
  ) {
    return true;
  }
  return false;
}

export function dedupeTeamMetrics(metrics: TeamMemberWeekMetrics[]): TeamMemberWeekMetrics[] {
  const byName = new Map<string, TeamMemberWeekMetrics>();
  for (const metric of metrics) {
    const key = metric.teamMemberName.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, metric);
  }
  return [...byName.values()].sort((a, b) => a.teamMemberName.localeCompare(b.teamMemberName));
}

export function buildTeamMetrics(
  config: CseActivityConfig,
  activities: NormalizedActivity[],
): TeamMemberWeekMetrics[] {
  return dedupeTeamMembers(config.teamMembers)
    .filter((m) => m.active !== false)
    .map((member) => {
      const memberActs = activities.filter((a) => activityMatchesMember(a, member));
      const dataAvailable = memberActs.length > 0;
      const customerFacing = memberActs.filter((a) => a.customerFacing).length;
      const strategicInternal = memberActs.filter(
        (a) => !a.customerFacing && a.category !== 'administrative',
      ).length;
      const accounts = new Set(memberActs.map((a) => a.accountId).filter(Boolean));
      const renewal = memberActs.filter((a) => a.category === 'renewal_risk_activity').length;
      const exec = memberActs.filter((a) => a.category === 'executive_engagement').length;
      const ai = memberActs.some((a) => a.category === 'ai_assisted_workflow')
        ? 'Observed'
        : dataAvailable
          ? 'No direct evidence'
          : 'Data not available';

      let managerNote = 'Data not available for this window.';
      if (dataAvailable) {
        if (customerFacing === 0 && strategicInternal > 0) {
          managerNote =
            'Internal/portfolio motion without customer-facing evidence — coaching opportunity on strategic outreach.';
        } else if (renewal > 0 && exec === 0) {
          managerNote = 'Renewal-risk motion present; consider earlier executive alignment on top accounts.';
        } else if (customerFacing > 0) {
          managerNote = 'Customer-facing motion observed — review account follow-through quality.';
        } else {
          managerNote = 'Limited classified activity — verify source coverage before coaching.';
        }
      }

      return {
        teamMemberId: member.email,
        teamMemberName: member.name,
        customerFacingCount: customerFacing,
        strategicInternalCount: strategicInternal,
        highValueAccountsTouched: accounts.size,
        renewalRisksTouched: renewal,
        executiveEngagementCount: exec,
        aiUsageSignal: ai,
        managerNote,
        dataAvailable,
      };
    });
}

export function buildAccountMetrics(
  views: AccountView[],
  activities: NormalizedActivity[],
  config: CseActivityConfig,
): AccountWeekMetrics[] {
  const priorityIds = new Set([
    ...config.strategicAccountIds,
    ...config.expand3AccountIds,
    ...config.renewalRiskAccountIds,
    ...config.atrRelevantAccountIds,
  ]);

  const sorted = [...views].sort((a, b) => {
    const aPri =
      priorityIds.has(a.account.accountId) || a.bucket !== 'Healthy' ? 1 : 0;
    const bPri =
      priorityIds.has(b.account.accountId) || b.bucket !== 'Healthy' ? 1 : 0;
    if (aPri !== bPri) return bPri - aPri;
    return b.atrUSD - a.atrUSD;
  });

  return sorted.slice(0, 40).map((v) => {
    const acts = activities.filter((a) => a.accountId === v.account.accountId);
    const customerFacing = acts.some((a) => a.customerFacing);
    const internalOnly = acts.length > 0 && !customerFacing;
    const activitySummary =
      acts.length > 0
        ? acts
            .slice(0, 3)
            .map((a) => a.title)
            .join('; ')
        : 'No evidence found in connected sources';

    let gap = acts.length === 0 ? 'No in-window activity in connected sources' : '—';
    if (internalOnly) gap = 'Internal discussion without customer-facing motion';
    if (v.bucket === 'Saveable Risk' && acts.length === 0) {
      gap = 'High-value renewal risk with no observed activity this week';
    }

    return {
      accountId: v.account.accountId,
      accountName: v.account.accountName,
      ownerName: v.account.assignedCSE?.name ?? null,
      healthRiskSignal: `${v.account.cseSentiment ?? 'Unset'} / ${v.risk.level}`,
      activityThisWeek: activitySummary,
      strategicMotion:
        acts.length > 0
          ? [...new Set(acts.flatMap((a) => a.strategicTags))].slice(0, 3).join(', ')
          : 'No direct evidence',
      gapConcern: gap,
      recommendedManagerAction:
        acts.length === 0
          ? 'Inspect coverage and confirm whether outreach is needed'
          : internalOnly
            ? 'Coach toward customer-facing next step'
            : 'Review follow-through and exec timing',
      customerFacing,
      internalOnly,
      atrUsd: v.atrUSD,
      bucket: v.bucket,
    };
  });
}

export function computeDerivedMetrics(
  activities: NormalizedActivity[],
  accountMetrics: AccountWeekMetrics[],
  teamMetrics: TeamMemberWeekMetrics[],
): DerivedWeekMetrics {
  const renewalActs = activities.filter((a) => a.category === 'renewal_risk_activity');
  const highRiskAccounts = accountMetrics.filter(
    (a) => a.bucket === 'Saveable Risk' || a.bucket === 'Confirmed Churn',
  );
  const withActivity = highRiskAccounts.filter((a) => a.activityThisWeek !== 'No evidence found in connected sources');
  return {
    highValueRenewalRisksWithActivity: withActivity.length,
    highValueRenewalRisksWithoutActivity: highRiskAccounts.length - withActivity.length,
    accountsWithExecutiveEngagement: activities.filter((a) => a.category === 'executive_engagement')
      .length,
    accountsWithCustomerFacingActivity: accountMetrics.filter((a) => a.customerFacing).length,
    accountsInternalOnly: accountMetrics.filter((a) => a.internalOnly).length,
    accountsStaleNextSteps: accountMetrics.filter((a) =>
      a.gapConcern.includes('No in-window'),
    ).length,
    healthSignalsReviewed: activities.filter((a) => a.category === 'health_signal_review').length,
    healthSignalsActedOn: renewalActs.length,
    teamMembersUsingAi: teamMetrics.filter((m) => m.aiUsageSignal === 'Observed').length,
    aiArtifactsCreated: activities.filter((a) => a.category === 'ai_assisted_workflow').length,
    followUpsCreatedOrCompleted: activities.filter((a) => a.category === 'customer_follow_up')
      .length,
    accountPlansUpdated: activities.filter((a) => a.category === 'account_planning').length,
  };
}

export function assessOverallStatus(
  derived: DerivedWeekMetrics,
  sourceSuccessCount: number,
  sourceAttemptCount: number,
): Pick<SnapshotMetadata, 'overallStatus' | 'strategicPosture' | 'confidenceLevel' | 'dataCoverage'> {
  const coverageRatio = sourceAttemptCount > 0 ? sourceSuccessCount / sourceAttemptCount : 0;
  const dataCoverage =
    coverageRatio >= 0.7 ? 'Strong' : coverageRatio >= 0.4 ? ('Partial' as const) : ('Weak' as const);

  let overallStatus: TrafficStatus = 'Yellow';
  if (
    derived.highValueRenewalRisksWithoutActivity > derived.highValueRenewalRisksWithActivity &&
    derived.highValueRenewalRisksWithoutActivity >= 3
  ) {
    overallStatus = 'Red';
  } else if (
    derived.accountsWithCustomerFacingActivity >= 5 &&
    derived.highValueRenewalRisksWithoutActivity <= 2
  ) {
    overallStatus = 'Green';
  }

  const strategicPosture =
    derived.accountsWithCustomerFacingActivity > derived.accountsInternalOnly
      ? 'Proactive'
      : derived.accountsInternalOnly > 0
        ? 'Mixed'
        : 'Reactive';

  const confidenceLevel =
    dataCoverage === 'Strong' ? 'High' : dataCoverage === 'Partial' ? 'Medium' : 'Low';

  return { overallStatus, strategicPosture, confidenceLevel, dataCoverage };
}
