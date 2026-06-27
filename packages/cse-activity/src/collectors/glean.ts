import type { AccountView } from '@mdas/canonical';
import type { NormalizedActivity, ReportingWindow, SourceCoverage } from '../types.js';
import { classifyFromMdasSignal } from '../classify.js';
import { isInWindow } from '../window.js';

/** Matches Data Quality page (`STALE_AFTER_DAYS` in read-model.ts). */
export const GLEAN_MCP_DISPLAY_STALE_DAYS = 7;

export interface GleanMcpFreshnessSummary {
  expand3Total: number;
  freshCount: number;
  staleCount: number;
  neverEnrichedCount: number;
  /** Accounts queried on latest refresh but no calendar/Slack indexed in Glean. */
  emptyAfterRefreshCount: number;
  latestRefresh?: {
    startedAt: string;
    gleanMcpRan: boolean;
  } | null;
}

export function isGleanMcpFreshForDisplay(
  lastFetchedIso: string | undefined,
  asOf = Date.now(),
): boolean {
  if (!lastFetchedIso) return false;
  const t = Date.parse(lastFetchedIso);
  if (!Number.isFinite(t) || t < 0) return false;
  return asOf - t <= GLEAN_MCP_DISPLAY_STALE_DAYS * 86_400_000;
}

/** User-facing freshness — aligned with /admin/data-quality, not adapter skip (24h). */
export function assessGleanMcpFreshness(
  views: AccountView[],
  opts?: { asOf?: number; latestRefresh?: { startedAt: string; gleanMcpRan: boolean } | null },
): GleanMcpFreshnessSummary {
  const asOf = opts?.asOf ?? Date.now();
  const expand3 = views.filter((v) => v.account.franchise === 'Expand 3');
  let freshCount = 0;
  let staleCount = 0;
  let neverEnrichedCount = 0;
  let emptyAfterRefreshCount = 0;

  const refreshStart = opts?.latestRefresh?.startedAt
    ? Date.parse(opts.latestRefresh.startedAt)
    : NaN;
  const gleanRanOnLatest =
    opts?.latestRefresh?.gleanMcpRan === true && Number.isFinite(refreshStart);

  for (const view of expand3) {
    const ts = view.account.lastFetchedFromSource?.['glean-mcp'];
    if (!ts) {
      neverEnrichedCount += 1;
      continue;
    }
    if (isGleanMcpFreshForDisplay(ts, asOf)) {
      freshCount += 1;
      if (
        gleanRanOnLatest &&
        Date.parse(ts) >= refreshStart - 60_000 &&
        (view.account.recentMeetings?.length ?? 0) === 0 &&
        !(view.account.sourceLinks ?? []).some((l) =>
          ['slack', 'calendar', 'gmail'].includes(l.source),
        )
      ) {
        emptyAfterRefreshCount += 1;
      }
      continue;
    }
    staleCount += 1;
  }

  return {
    expand3Total: expand3.length,
    freshCount,
    staleCount,
    neverEnrichedCount,
    emptyAfterRefreshCount,
    latestRefresh: opts?.latestRefresh ?? null,
  };
}

export function gleanMcpNeedsRefreshWarning(summary: GleanMcpFreshnessSummary): boolean {
  if (summary.staleCount > 0) return true;
  if (summary.neverEnrichedCount === 0) return false;
  if (summary.latestRefresh?.gleanMcpRan) return false;
  return summary.neverEnrichedCount > 0;
}

function gleanFreshnessNote(summary: GleanMcpFreshnessSummary): string {
  const { expand3Total, freshCount, staleCount, neverEnrichedCount, emptyAfterRefreshCount } =
    summary;
  const needsRefresh = gleanMcpNeedsRefreshWarning(summary);
  if (expand3Total === 0) return 'No Expand 3 accounts in MDAS.';
  if (!needsRefresh && staleCount === 0 && neverEnrichedCount === 0) {
    return `Glean enrichment fresh on all ${freshCount} Expand 3 accounts (via MDAS Refresh).`;
  }
  if (!needsRefresh && summary.latestRefresh?.gleanMcpRan) {
    const withHits = freshCount - emptyAfterRefreshCount;
    return `Glean queried on latest MDAS Refresh: ${withHits} accounts with in-window calendar/Slack, ${emptyAfterRefreshCount} with no indexed customer touchpoints.`;
  }
  const parts: string[] = [];
  if (freshCount > 0) parts.push(`${freshCount} fresh`);
  if (staleCount > 0) parts.push(`${staleCount} stale (>${GLEAN_MCP_DISPLAY_STALE_DAYS}d)`);
  if (neverEnrichedCount > 0) parts.push(`${neverEnrichedCount} never queried`);
  return `${parts.join(', ')} of ${expand3Total} Expand 3 accounts — run MDAS Refresh for calendar/Slack/Gmail.`;
}

export interface GleanCollectorInput {
  views: AccountView[];
  window: ReportingWindow;
}

function gleanStampForView(view: AccountView): string {
  return view.account.lastFetchedFromSource?.['glean-mcp'] ?? view.account.lastUpdated;
}

function meetingKind(source: string): string {
  if (source === 'zoom') return 'meeting';
  if (source === 'staircase') return 'glean_email';
  return 'meeting';
}

export function meetingToGleanActivity(
  view: AccountView,
  meeting: {
    source: string;
    title: string;
    startTime: string;
    summary: string | null;
    url: string | null;
  },
  window: ReportingWindow,
): NormalizedActivity | null {
  if (!isInWindow(meeting.startTime, window)) return null;
  const cse = view.account.assignedCSE;
  const classified = classifyFromMdasSignal({
    kind: meetingKind(meeting.source),
    title: meeting.title,
    summary: meeting.summary ?? '',
    bucket: view.bucket,
  });
  const id = meeting.url
    ? `glean-meeting-${view.account.accountId}-${meeting.url}`
    : `glean-meeting-${view.account.accountId}-${meeting.startTime}-${meeting.title}`;
  return {
    id,
    source: meeting.source === 'staircase' ? 'glean_gmail' : 'glean_calendar',
    sourceRef: meeting.url ?? undefined,
    occurredAt: meeting.startTime,
    teamMemberId: cse?.id ?? null,
    teamMemberName: cse?.name ?? null,
    accountId: view.account.accountId,
    accountName: view.account.accountName,
    title: meeting.title,
    summary: meeting.summary ?? `Customer touchpoint (${meeting.source}).`,
    ...classified,
    evidenceLevel: meeting.summary ? 'direct' : 'metadata_only',
  };
}

export function sourceLinkToGleanActivity(
  view: AccountView,
  link: { source: string; label: string; url: string },
  occurredAt: string,
  window: ReportingWindow,
): NormalizedActivity | null {
  if (!isInWindow(occurredAt, window)) return null;

  let kind = 'glean_link';
  if (link.source === 'slack') kind = 'slack';
  else if (link.source === 'calendar') kind = 'meeting';
  else if (link.source === 'gmail') kind = 'glean_email';

  const classified = classifyFromMdasSignal({
    kind,
    title: link.label,
    summary: link.url,
    bucket: view.bucket,
  });
  const cse = view.account.assignedCSE;
  return {
    id: `glean-link-${view.account.accountId}-${link.url}`,
    source: link.source === 'slack' ? 'glean_slack' : 'glean',
    sourceRef: link.url,
    occurredAt,
    teamMemberId: cse?.id ?? null,
    teamMemberName: cse?.name ?? null,
    accountId: view.account.accountId,
    accountName: view.account.accountName,
    title: link.label,
    summary: `Glean-indexed ${link.source} activity.`,
    ...classified,
    evidenceLevel: 'metadata_only',
  };
}

export function collectGleanActivitiesFromViews(input: GleanCollectorInput): {
  activities: NormalizedActivity[];
  coverage: SourceCoverage;
} {
  const activities: NormalizedActivity[] = [];
  let calendarCount = 0;
  let slackCount = 0;
  let emailCount = 0;

  for (const view of input.views) {
    if (view.account.franchise !== 'Expand 3') continue;

    for (const meeting of view.account.recentMeetings ?? []) {
      const act = meetingToGleanActivity(view, meeting, input.window);
      if (!act) continue;
      activities.push(act);
      if (meeting.source === 'staircase') emailCount++;
      else calendarCount++;
    }

    const gleanStamp = gleanStampForView(view);
    for (const link of view.account.sourceLinks ?? []) {
      if (link.source !== 'slack' && link.source !== 'calendar' && link.source !== 'gmail') continue;
      const act = sourceLinkToGleanActivity(view, link, gleanStamp, input.window);
      if (!act) continue;
      activities.push(act);
      if (link.source === 'slack') slackCount++;
      else if (link.source === 'gmail') emailCount++;
      else calendarCount++;
    }
  }

  const freshness = assessGleanMcpFreshness(input.views);
  const staleTotal = freshness.staleCount + freshness.neverEnrichedCount;
  const enrichmentFresh = staleTotal === 0 && freshness.expand3Total > 0;

  return {
    activities,
    coverage: {
      source: 'Glean (calendar, Slack, Gmail via MDAS Refresh)',
      status:
        activities.length > 0
          ? 'success'
          : enrichmentFresh
            ? 'partial'
            : staleTotal > 0
              ? 'partial'
              : 'failed',
      notes:
        activities.length > 0
          ? `${activities.length} customer-touch activities from MDAS Glean enrichment (${calendarCount} calendar/zoom, ${slackCount} Slack, ${emailCount} email). ${gleanFreshnessNote(freshness)}`
          : enrichmentFresh
            ? `No in-window customer touchpoints matched. ${gleanFreshnessNote(freshness)}`
            : gleanFreshnessNote(freshness),
      impactOfGap:
        activities.length > 0
          ? 'Low — calendar/Slack/email visible for coaching.'
          : staleTotal > 0
            ? 'High — run MDAS Refresh (glean-mcp adapter) before snapshot for current calendar/Slack.'
            : 'Medium — enrichment is fresh but no in-window touchpoints matched.',
      recordsFound: activities.length,
    },
  };
}

export function mergeActivities(...groups: NormalizedActivity[][]): NormalizedActivity[] {
  const byId = new Map<string, NormalizedActivity>();
  for (const group of groups) {
    for (const activity of group) {
      byId.set(activity.id, activity);
    }
  }
  return [...byId.values()];
}
