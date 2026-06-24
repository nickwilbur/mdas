import type { CTAEngineConfig } from './config.js';
import type { CTARecord, CTALogEntry } from './types.js';
import { isCtaOpen, resolveRenewalOpportunityId } from './progress.js';
import { dedupKey, isWithinDedupWindow } from './suppress.js';

export interface DedupDecision {
  action: 'create' | 'update' | 'skip';
  existing?: CTALogEntry;
  reason?: string;
}

/**
 * Decide whether to create, update, or skip a CTA given existing log entries.
 */
export function decideDedup(
  cta: CTARecord,
  existingLog: Map<string, CTALogEntry>,
  config: CTAEngineConfig,
  now: number = Date.now(),
): DedupDecision {
  const key =
    cta.dedup_key ??
    dedupKey(cta.salesforce_account_id, cta.play_type, cta.renewal_opportunity_id);

  // Find most recent open entry with same dedup key
  let latest: CTALogEntry | undefined;
  for (const entry of existingLog.values()) {
    const entryKey =
      entry.dedup_key ??
      dedupKey(
        entry.salesforce_account_id,
        entry.play_type,
        resolveRenewalOpportunityId(entry),
      );
    if (entryKey !== key) continue;
    if (!isCtaOpen(entry.status)) continue;
    if (!latest || entry.posted_at > latest.posted_at) latest = entry;
  }

  if (!latest) return { action: 'create' };

  if (isWithinDedupWindow(latest.posted_at, config.dedupWindowDays, now)) {
    // Update in place if signals changed (priority or drivers)
    const priorityChanged =
      (cta.priority_score ?? 0) !== (latest.priority_score ?? 0);
    const driversChanged =
      JSON.stringify(cta.drivers ?? []) !== JSON.stringify(latest.drivers ?? []);
    if (priorityChanged || driversChanged) {
      return { action: 'update', existing: latest };
    }
    return {
      action: 'skip',
      existing: latest,
      reason: `Open CTA within ${config.dedupWindowDays}d dedup window`,
    };
  }

  return { action: 'create' };
}

export function mergeCTAUpdate(
  existing: CTALogEntry,
  fresh: CTARecord,
  scanDate: string,
): CTALogEntry {
  const now = new Date().toISOString();
  return {
    ...existing,
    ...fresh,
    cta_id: existing.cta_id,
    posted_at: existing.posted_at,
    posted_to_channel: existing.posted_to_channel,
    status: existing.status,
    assigned_owner: existing.assigned_owner ?? null,
    due_date: existing.due_date ?? fresh.deadline ?? null,
    progress_note: existing.progress_note ?? null,
    created_at: existing.created_at ?? existing.posted_at,
    updated_at: now,
    completed_at: existing.completed_at ?? null,
    last_checked_at: `${scanDate}T${new Date().toISOString().slice(11)}`,
    escalation_message_id: existing.escalation_message_id,
  };
}

/**
 * Cap CTAs by priority_score after sorting.
 */
export function capCtas(ctas: CTARecord[], max: number): CTARecord[] {
  return [...ctas]
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
    .slice(0, max);
}
