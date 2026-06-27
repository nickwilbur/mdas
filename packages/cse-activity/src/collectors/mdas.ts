import type { AccountView, ChangeEvent } from '@mdas/canonical';
import type { CseActivityConfig, NormalizedActivity, SourceCoverage, ReportingWindow } from '../types.js';
import { classifyFromMdasSignal } from '../classify.js';
import { isInWindow } from '../window.js';

export interface MdasCollectorInput {
  views: AccountView[];
  changeEvents: ChangeEvent[];
  ctaUpdates: Array<{
    cta_id: string;
    account_name: string;
    salesforce_account_id?: string;
    play_type?: string;
    status?: string;
    updated_at?: string;
    owner?: string;
    atr_at_risk_usd?: number;
  }>;
  window: ReportingWindow;
  config: CseActivityConfig;
}

export function collectMdasActivities(input: MdasCollectorInput): {
  activities: NormalizedActivity[];
  coverage: SourceCoverage;
} {
  const activities: NormalizedActivity[] = [];

  for (const view of input.views) {
    const cse = view.account.assignedCSE;
    const memberId = cse?.id ?? null;
    const memberName = cse?.name ?? null;

    // recentMeetings / Slack / calendar email are collected via glean collector.

    for (const workshop of view.account.workshops ?? []) {
      const date = workshop.workshopDate;
      if (!date || !isInWindow(`${date}T12:00:00.000Z`, input.window)) continue;
      const classified = classifyFromMdasSignal({
        kind: 'workshop',
        title: workshop.engagementType,
        summary: workshop.status,
        bucket: view.bucket,
      });
      activities.push({
        id: `mdas-workshop-${view.account.accountId}-${workshop.id}`,
        source: 'mdas',
        occurredAt: `${date}T12:00:00.000Z`,
        teamMemberId: memberId,
        teamMemberName: memberName,
        accountId: view.account.accountId,
        accountName: view.account.accountName,
        title: workshop.engagementType,
        summary: `Workshop status: ${workshop.status}`,
        ...classified,
        evidenceLevel: 'metadata_only',
      });
    }

    for (const task of view.account.gainsightTasks ?? []) {
      const due = task.dueDate ? `${task.dueDate}T12:00:00.000Z` : null;
      const stamp = due ?? view.account.lastUpdated;
      if (!isInWindow(stamp, input.window)) continue;
      const classified = classifyFromMdasSignal({
        kind: 'task',
        title: task.title,
        summary: task.status,
        bucket: view.bucket,
      });
      activities.push({
        id: `mdas-task-${view.account.accountId}-${task.id}`,
        source: 'gainsight',
        occurredAt: stamp,
        teamMemberId: memberId,
        teamMemberName: memberName,
        accountId: view.account.accountId,
        accountName: view.account.accountName,
        title: task.title,
        summary: `Gainsight task (${task.status})`,
        ...classified,
        evidenceLevel: 'metadata_only',
      });
    }
  }

  for (const event of input.changeEvents) {
    // WoW events are pre-filtered to the dashboard window; ChangeEvent has no wall-clock timestamp.
    const occurredAt = input.window.windowEnd;
    const view = input.views.find((v) => v.account.accountId === event.accountId);
    const summary = event.label;
    const classified = classifyFromMdasSignal({
      kind: 'change_event',
      title: event.category,
      summary,
      bucket: view?.bucket,
      changeCategory: event.category,
      field: event.field,
    });
    activities.push({
      id: `mdas-change-${event.accountId}-${event.field}-${occurredAt}`,
      source: 'mdas',
      occurredAt,
      teamMemberId: view?.account.assignedCSE?.id ?? null,
      teamMemberName: view?.account.assignedCSE?.name ?? null,
      accountId: event.accountId,
      accountName: view?.account.accountName ?? event.accountId,
      title: `${event.category}: ${event.field}`,
      summary,
      ...classified,
      evidenceLevel: 'direct',
    });
  }

  for (const cta of input.ctaUpdates) {
    const stamp = cta.updated_at ?? input.window.windowEnd;
    if (!isInWindow(stamp, input.window)) continue;
    const view = input.views.find(
      (v) =>
        v.account.salesforceAccountId === cta.salesforce_account_id ||
        v.account.accountName === cta.account_name,
    );
    const classified = classifyFromMdasSignal({
      kind: 'cta',
      title: cta.play_type ?? 'cta',
      summary: cta.status ?? '',
      bucket: view?.bucket,
      playType: cta.play_type,
    });
    activities.push({
      id: `mdas-cta-${cta.cta_id}`,
      source: 'mdas_cta',
      occurredAt: stamp,
      teamMemberId: view?.account.assignedCSE?.id ?? null,
      teamMemberName: cta.owner ?? view?.account.assignedCSE?.name ?? null,
      accountId: view?.account.accountId ?? cta.salesforce_account_id ?? null,
      accountName: cta.account_name,
      title: `CTA: ${cta.play_type ?? 'renewal risk'}`,
      summary: `Status ${cta.status ?? 'open'}; ATR at risk ${cta.atr_at_risk_usd ?? '—'}`,
      ...classified,
      evidenceLevel: 'direct',
    });
  }

  return {
    activities,
    coverage: {
      source: 'MDAS (account views, WoW, CTAs)',
      status: activities.length > 0 ? 'success' : 'partial',
      notes:
        activities.length > 0
          ? `${activities.length} normalized activities from MDAS snapshots in the reporting window.`
          : 'MDAS connected but no in-window activity matched filters — may reflect data freshness, not zero work.',
      impactOfGap:
        activities.length > 0
          ? 'Low — core portfolio signals available.'
          : 'Medium — manager view relies on other sources until next refresh.',
      recordsFound: activities.length,
    },
  };
}

export function stubSourceCoverage(
  source: string,
  status: SourceCoverage['status'],
  notes: string,
): SourceCoverage {
  return {
    source,
    status,
    notes,
    impactOfGap:
      status === 'not_configured'
        ? 'High — activity may exist but is not visible in this snapshot.'
        : 'Medium — conclusions should be treated as partial.',
    recordsFound: 0,
  };
}
