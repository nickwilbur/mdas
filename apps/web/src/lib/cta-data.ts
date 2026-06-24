import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { CTALogEntry } from '@mdas/cta-engine';
import { normalizeCtaStatus, effectiveCtaOwner, enrichCtaLogEntry, indexCtaLogByDedupKey } from '@mdas/cta-engine';
import { parseScanMarkdown, generateSlackMessage, type RichCTA } from './cta-utils';
import { ctaProjectRoot, ctaLogPath } from './cta-project-root';
import type { CTAEntry } from '@/components/CTABoard';

export interface LoadedCtaData {
  ctas: CTAEntry[];
  logEntries: CTALogEntry[];
  slackMessages: Record<string, string>;
}

export function loadCTAData(): LoadedCtaData {
  const projectRoot = ctaProjectRoot();
  const ctas: CTAEntry[] = [];
  const slackMessages: Record<string, string> = {};
  const richMap = new Map<string, RichCTA>();
  const slackMap = new Map<string, string>();

  const scanFiles = readdirSync(projectRoot)
    .filter((f) => f.startsWith('expand3_cta_scan_') && f.endsWith('.md'))
    .sort()
    .reverse();
  const latestScan = scanFiles[0];
  if (latestScan) {
    const content = readFileSync(join(projectRoot, latestScan), 'utf-8');
    const { richCTAs, slackMessages: msgs } = parseScanMarkdown(content);
    for (const [id, cta] of richCTAs) richMap.set(id, cta);
    for (const [id, msg] of msgs) slackMap.set(id, msg);
  }

  const statusMap = new Map<string, Record<string, unknown>>();
  const jsonlPath = ctaLogPath();
  if (existsSync(jsonlPath)) {
    const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        statusMap.set(entry.cta_id as string, entry);
        if (entry.account_name && !richMap.has(entry.cta_id as string)) {
          richMap.set(entry.cta_id as string, entry as unknown as RichCTA);
        }
      } catch {
        continue;
      }
    }
  }

  const logEntries = (
    [...statusMap.values()].map((entry) =>
      enrichCtaLogEntry(
        entry as Pick<
          CTALogEntry,
          | 'renewal_opportunity_id'
          | 'renewal_opportunity_url'
          | 'salesforce_account_id'
          | 'play_type'
          | 'dedup_key'
        >,
      ),
    ) as unknown as CTALogEntry[]
  );
  const trackingByDedup = indexCtaLogByDedupKey(logEntries);

  const allIds = new Set([...richMap.keys(), ...statusMap.keys()]);
  for (const id of allIds) {
    const rich = richMap.get(id);
    let tracking = statusMap.get(id);

    if (!rich) continue;

    if (!tracking) {
      const dedupKey = enrichCtaLogEntry({
        renewal_opportunity_id: rich.renewal_opportunity_id ?? null,
        renewal_opportunity_url: rich.renewal_opportunity_url ?? null,
        salesforce_account_id: rich.salesforce_account_id,
        play_type: rich.play_type,
        dedup_key: (rich as { dedup_key?: string }).dedup_key,
      }).dedup_key;
      const fromDedup = trackingByDedup.get(dedupKey);
      if (fromDedup) tracking = fromDedup as unknown as Record<string, unknown>;
    }

    const ownerFromRich = rich?.primary_owner;
    const ownerName =
      typeof ownerFromRich === 'object' && ownerFromRich
        ? ownerFromRich.name
        : (tracking?.primary_owner as string) ?? 'Unknown';

    const allOwners = [
      ...(typeof ownerFromRich === 'object' && ownerFromRich ? [ownerFromRich] : []),
      ...(rich?.cc_owners ?? []),
    ];

    const ae =
      (rich?.ae as CTAEntry['ae']) ??
      allOwners.find((o) => o.role === 'AE') ??
      null;
    const cse =
      (rich?.cse as CTAEntry['cse']) ??
      allOwners.find((o) => o.role === 'CSE') ??
      null;
    const tam = allOwners.find((o) => o.role === 'TAM') ?? null;
    const esa = allOwners.find((o) => o.role === 'ESA') ?? null;

    const mergedTracking = tracking as CTALogEntry | undefined;
    const status = normalizeCtaStatus(mergedTracking?.status as string | undefined);

    const entry: CTAEntry = {
      cta_id: id,
      account_name:
        rich?.account_name ?? (tracking?.account_name as string) ?? 'Unknown',
      salesforce_account_id:
        rich?.salesforce_account_id ??
        (tracking?.salesforce_account_id as string | null) ??
        null,
      play_type: rich?.play_type ?? (tracking?.play_type as string) ?? 'unknown',
      risk_color: rich?.risk_color ?? (tracking?.risk_color as string) ?? '🟢',
      primary_owner: mergedTracking?.assigned_owner ?? rich?.primary_owner ?? ownerName,
      cc_owners: rich?.cc_owners,
      destination_slack_channel:
        rich?.destination_slack_channel ??
        (tracking?.destination_slack_channel as string | null) ??
        null,
      renewal_opportunity_id:
        rich?.renewal_opportunity_id ??
        (tracking?.renewal_opportunity_id as string | null) ??
        enrichCtaLogEntry({
          renewal_opportunity_id: null,
          renewal_opportunity_url:
            rich?.renewal_opportunity_url ??
            (tracking?.renewal_opportunity_url as string | null) ??
            null,
          salesforce_account_id:
            rich?.salesforce_account_id ??
            (tracking?.salesforce_account_id as string | null) ??
            null,
          play_type:
            rich?.play_type ?? (tracking?.play_type as string) ?? 'unknown',
          dedup_key: (tracking?.dedup_key as string | undefined) ?? undefined,
        }).renewal_opportunity_id,
      renewal_opportunity_url:
        rich?.renewal_opportunity_url ??
        (tracking?.renewal_opportunity_url as string | null) ??
        null,
      drivers: rich?.drivers,
      requested_action: rich?.requested_action,
      deadline:
        (mergedTracking?.due_date as string | null) ??
        rich?.deadline ??
        (tracking?.deadline as string) ??
        '',
      check_back_date:
        rich?.check_back_date ??
        rich?.follow_through?.check_back_date ??
        (tracking?.check_back_date as string) ??
        '',
      expected_artifact:
        rich?.expected_artifact ??
        rich?.follow_through?.expected_artifact ??
        (tracking?.expected_artifact as string) ??
        '',
      follow_through: rich?.follow_through,
      data_gaps: rich?.data_gaps,
      posted_at: (tracking?.posted_at as string) ?? '',
      posted_to_channel: (tracking?.posted_to_channel as string) ?? 'dry-run',
      status,
      last_checked_at: (tracking?.last_checked_at as string | null) ?? null,
      escalation_message_id:
        (tracking?.escalation_message_id as string | null) ?? null,
      assigned_owner: mergedTracking?.assigned_owner ?? null,
      due_date: (mergedTracking?.due_date as string | null) ?? rich?.deadline ?? null,
      progress_note: (mergedTracking?.progress_note as string | null) ?? null,
      created_at:
        (mergedTracking?.created_at as string | null) ??
        (tracking?.posted_at as string | null) ??
        null,
      updated_at:
        (mergedTracking?.updated_at as string | null) ??
        (tracking?.last_checked_at as string | null) ??
        null,
      completed_at: (mergedTracking?.completed_at as string | null) ?? null,
      ae,
      cse,
      tam,
      esa,
      cse_sentiment_commentary: rich?.cse_sentiment_commentary ?? null,
      commentary_last_updated: rich?.commentary_last_updated ?? null,
      team_aware: Boolean(rich?.team_aware),
      situation_read: rich?.situation_read ?? null,
      point_of_view: rich?.point_of_view ?? null,
      atr_at_risk_usd: rich?.atr_at_risk_usd ?? null,
      renewal_opportunity_name: rich?.renewal_opportunity_name ?? null,
      owner_display: effectiveCtaOwner({
        assigned_owner: mergedTracking?.assigned_owner ?? null,
        primary_owner: rich?.primary_owner ?? ownerName,
      }),
    };
    ctas.push(entry);
    if (slackMap.has(id)) {
      slackMessages[id] = slackMap.get(id)!;
    } else if (rich) {
      slackMessages[id] = generateSlackMessage(rich);
    }
  }

  ctas.sort((a, b) => {
    const riskOrder: Record<string, number> = {
      '🔴': 0, Red: 0,
      '🟡': 1, Yellow: 1,
      '🟢': 2, Green: 2,
    };
    const ra = riskOrder[a.risk_color] ?? 3;
    const rb = riskOrder[b.risk_color] ?? 3;
    if (ra !== rb) return ra - rb;
    return a.deadline.localeCompare(b.deadline);
  });

  return { ctas, logEntries, slackMessages };
}
