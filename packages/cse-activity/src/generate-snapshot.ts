import type { AccountView, ChangeEvent } from '@mdas/canonical';
import type { CseActivityConfig, SourceCoverage, WeeklySnapshot } from './types.js';
import { resolveReportingWindow } from './window.js';
import { collectMdasActivities, stubSourceCoverage } from './collectors/mdas.js';
import {
  assessGleanMcpFreshness,
  collectGleanActivitiesFromViews,
  gleanMcpNeedsRefreshWarning,
  GLEAN_MCP_DISPLAY_STALE_DAYS,
} from './collectors/glean.js';
import {
  assessOverallStatus,
  buildAccountMetrics,
  buildTeamMetrics,
  computeDerivedMetrics,
} from './metrics.js';
import { generateManagerDashboard } from './manager-dashboard.js';
import { generateAllTeamReports } from './team-report.js';
import { resolveCseActivityConfig, dedupeTeamMembers } from './infer-config.js';
import { writeSnapshotFiles } from './storage.js';

export interface GenerateSnapshotInput {
  projectRoot: string;
  config: CseActivityConfig;
  views: AccountView[];
  changeEvents: ChangeEvent[];
  ctaUpdates: Array<Record<string, unknown>>;
  mdasRefresh?: { refreshId: string | null; startedAt: string | null };
  anchor?: Date;
  force?: boolean;
}

export interface GenerateSnapshotResult {
  snapshotDate: string;
  dir: string;
  managerDashboardMd: string;
  teamReportNames: string[];
  skipped?: boolean;
}

export function buildWeeklySnapshot(input: GenerateSnapshotInput): WeeklySnapshot {
  const config = resolveCseActivityConfig(input.config, input.views);
  const window = resolveReportingWindow({
    timezone: config.timezone,
    fridayEodTime: config.fridayEodTime,
    anchor: input.anchor,
  });

  const mdas = collectMdasActivities({
    views: input.views,
    changeEvents: input.changeEvents,
    ctaUpdates: input.ctaUpdates as Parameters<typeof collectMdasActivities>[0]['ctaUpdates'],
    window,
    config,
  });

  const gleanFromViews = collectGleanActivitiesFromViews({ views: input.views, window });
  const allActivities = [...mdas.activities, ...gleanFromViews.activities];
  const gleanCoverage = gleanFromViews.coverage;
  const gleanFreshness = assessGleanMcpFreshness(input.views);

  const sourceCoverage = [
    mdas.coverage,
    gleanCoverage,
    stubSourceCoverage(
      'Slack (direct API)',
      config.prioritySlackChannels.length > 0 ? 'skipped' : 'skipped',
      'Customer Slack covered via Glean index; direct Slack API not required for v1.',
    ),
    stubSourceCoverage(
      'Google Calendar (direct OAuth)',
      gleanCoverage.recordsFound > 0 ? 'skipped' : 'partial',
      gleanCoverage.recordsFound > 0
        ? 'Calendar meetings ingested via Glean — direct OAuth not required.'
        : 'Calendar depends on Glean enrichment; run MDAS Refresh with Glean connected.',
    ),
    stubSourceCoverage('CRM (Salesforce)', 'partial', 'Indirect via MDAS snapshots and CTA log.'),
    stubSourceCoverage('Gainsight / CS platform', 'partial', 'Task metadata via MDAS when present.'),
    stubSourceCoverage('Support / escalation', 'not_configured', 'Not connected in v1.'),
    stubSourceCoverage('AI usage / enablement', 'partial', 'Inferred from MDAS/Glean workflows; no usage log yet.'),
  ];

  const teamActivity = allActivities;
  const accountActivity = allActivities;
  const calendarActivity = allActivities.filter(
    (a) => a.source === 'glean_calendar' || a.category === 'customer_meeting' || a.category === 'executive_engagement',
  );
  const slackActivity = allActivities.filter((a) => a.source === 'glean_slack');
  const teamMetrics = buildTeamMetrics(config, teamActivity);
  const accountMetrics = buildAccountMetrics(input.views, accountActivity, config);
  const derivedMetrics = computeDerivedMetrics(teamActivity, accountMetrics, teamMetrics);

  const successful = sourceCoverage.filter((s) => s.status === 'success' || s.status === 'partial');
  const attempted = sourceCoverage;
  const assessment = assessOverallStatus(derivedMetrics, successful.length, attempted.length);

  const metadata = {
    generatedAt: new Date().toISOString(),
    reportingWindowStart: window.windowStart,
    reportingWindowEnd: window.windowEnd,
    timezone: window.timezone,
    snapshotDate: window.snapshotDate,
    dataSourcesAttempted: attempted.map((s) => s.source),
    dataSourcesSuccessful: successful.map((s) => s.source),
    dataSourcesFailed: sourceCoverage
      .filter((s) => s.status === 'failed' || s.status === 'not_configured')
      .map((s) => s.source),
    teamMembersIncluded: dedupeTeamMembers(config.teamMembers)
      .filter((m) => m.active !== false)
      .map((m) => m.name),
    teamMemberConfigs: dedupeTeamMembers(config.teamMembers),
    accountsIncluded: input.views.map((v) => v.account.accountId),
    knownDataGaps: [
      ...sourceCoverage.filter((s) => s.status !== 'success').map((s) => `${s.source}: ${s.notes}`),
      ...(gleanMcpNeedsRefreshWarning(gleanFreshness)
        ? [
            `MDAS Glean enrichment needs attention: ${gleanFreshness.staleCount + gleanFreshness.neverEnrichedCount}/${gleanFreshness.expand3Total} Expand 3 accounts (${gleanFreshness.staleCount} stale >${GLEAN_MCP_DISPLAY_STALE_DAYS}d, ${gleanFreshness.neverEnrichedCount} never queried).`,
          ]
        : []),
      ...(input.mdasRefresh?.refreshId
        ? [`MDAS refresh ${input.mdasRefresh.refreshId}${input.mdasRefresh.startedAt ? ` (${input.mdasRefresh.startedAt})` : ''}.`]
        : []),
    ],
    immutable: true,
    derivedMetrics,
    teamMetrics,
    accountMetrics,
    sourceCoverage,
    ...assessment,
  };

  return {
    metadata,
    teamActivity,
    accountActivity,
    teamMetrics,
    accountMetrics,
    sourceCoverage,
    calendarActivity,
    slackActivity,
    crmActivity: [],
    renewalRiskActivity: accountMetrics.filter((a) => a.bucket !== 'Healthy'),
    aiEnablementActivity: [],
  };
}

export function generateWeeklySnapshotPackage(
  input: GenerateSnapshotInput,
): GenerateSnapshotResult {
  const snapshot = buildWeeklySnapshot(input);
  const managerDashboardMd = generateManagerDashboard(snapshot);
  const config = resolveCseActivityConfig(input.config, input.views);
  const teamReports = generateAllTeamReports(snapshot, config);
  const dir = writeSnapshotFiles(
    input.projectRoot,
    config,
    snapshot,
    managerDashboardMd,
    teamReports,
  );
  return {
    snapshotDate: snapshot.metadata.snapshotDate,
    dir,
    managerDashboardMd,
    teamReportNames: Object.keys(teamReports),
  };
}
