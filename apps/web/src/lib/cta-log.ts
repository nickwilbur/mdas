import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  CTA_PROGRESS_STATUSES,
  enrichCtaLogEntry,
  isCtaOpen,
  normalizeCtaStatus,
  type CTAProgressStatus,
} from '@mdas/cta-engine';
import { ctaLogPath } from './cta-project-root';

export type CTAStatus = CTAProgressStatus;

export const ALLOWED_CTA_STATUSES = CTA_PROGRESS_STATUSES;

export interface CTALogRecord {
  cta_id: string;
  status?: string;
  assigned_owner?: string | { name: string; role?: string } | null;
  due_date?: string | null;
  progress_note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  closed_at?: string | null;
  last_checked_at?: string | null;
  renewal_opportunity_id?: string | null;
  [key: string]: unknown;
}

export interface CtaProgressPatch {
  status?: CTAProgressStatus;
  assigned_owner?: string | null;
  due_date?: string | null;
  progress_note?: string | null;
}

function readAllLines(): CTALogRecord[] {
  const path = ctaLogPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as CTALogRecord;
      } catch {
        return null;
      }
    })
    .filter((e): e is CTALogRecord => e != null && Boolean(e.cta_id));
}

function rewriteEntry(ctaId: string, updater: (entry: CTALogRecord) => CTALogRecord): {
  ok: true;
  entry: CTALogRecord;
} | {
  ok: false;
  error: string;
} {
  const path = ctaLogPath();
  if (!existsSync(path)) {
    return { ok: false, error: 'CTA log not found' };
  }

  const lines = readFileSync(path, 'utf-8').split('\n');
  let found = false;
  let updatedEntry: CTALogRecord | null = null;

  const newLines: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as CTALogRecord;
      if (entry.cta_id !== ctaId) {
        newLines.push(line);
        continue;
      }
      found = true;
      updatedEntry = updater(entry);
      newLines.push(JSON.stringify(updatedEntry));
    } catch {
      newLines.push(line);
    }
  }

  if (!found || !updatedEntry) {
    return { ok: false, error: 'CTA not found' };
  }

  writeFileSync(path, `${newLines.join('\n')}\n`, 'utf-8');
  return { ok: true, entry: updatedEntry };
}

function enrichLogRecord(entry: CTALogRecord): CTALogRecord {
  const enriched = enrichCtaLogEntry({
    renewal_opportunity_id: (entry.renewal_opportunity_id as string | null | undefined) ?? null,
    renewal_opportunity_url:
      (entry.renewal_opportunity_url as string | null | undefined) ?? null,
    salesforce_account_id: (entry.salesforce_account_id as string | null | undefined) ?? null,
    play_type: (entry.play_type as string | undefined) ?? 'unknown',
    dedup_key: entry.dedup_key as string | undefined,
  });
  return { ...entry, ...enriched };
}

/**
 * Read all CTA log entries from expand3_cta_log.jsonl.
 */
export function readCtaLog(): CTALogRecord[] {
  return readAllLines().map(enrichLogRecord);
}

/**
 * Backfill renewal_opportunity_id from renewal_opportunity_url for legacy entries.
 */
export function backfillCtaLogOpportunityIds(): {
  updated: number;
  total: number;
} {
  const path = ctaLogPath();
  const entries = readAllLines();
  let updated = 0;

  const newLines = entries.map((entry) => {
    const enriched = enrichLogRecord(entry);
    const changed =
      entry.renewal_opportunity_id !== enriched.renewal_opportunity_id ||
      entry.dedup_key !== enriched.dedup_key;
    if (changed) updated++;
    return JSON.stringify(enriched);
  });

  if (entries.length > 0) {
    writeFileSync(path, `${newLines.join('\n')}\n`, 'utf-8');
  }

  return { updated, total: entries.length };
}

/**
 * Update status for a CTA in expand3_cta_log.jsonl (rewrites the matching line).
 */
export function updateCtaStatus(
  ctaId: string,
  status: CTAStatus,
): { ok: true; entry: CTALogRecord } | { ok: false; error: string } {
  return updateCtaProgress(ctaId, { status });
}

/**
 * Update progress fields for a CTA in expand3_cta_log.jsonl.
 */
export function updateCtaProgress(
  ctaId: string,
  patch: CtaProgressPatch,
): { ok: true; entry: CTALogRecord } | { ok: false; error: string } {
  if (patch.status && !ALLOWED_CTA_STATUSES.includes(patch.status)) {
    return { ok: false, error: `status must be one of: ${ALLOWED_CTA_STATUSES.join(', ')}` };
  }

  const now = new Date().toISOString();

  return rewriteEntry(ctaId, (entry) => {
    const nextStatus = patch.status
      ? normalizeCtaStatus(patch.status)
      : normalizeCtaStatus(entry.status);
    const done = !isCtaOpen(nextStatus);

    return {
      ...entry,
      ...(patch.status ? { status: nextStatus } : {}),
      ...(patch.assigned_owner !== undefined
        ? { assigned_owner: patch.assigned_owner }
        : {}),
      ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
      ...(patch.progress_note !== undefined ? { progress_note: patch.progress_note } : {}),
      created_at:
        (typeof entry.created_at === 'string' ? entry.created_at : null) ??
        (typeof entry.posted_at === 'string' ? entry.posted_at : null) ??
        now,
      updated_at: now,
      last_checked_at: now,
      completed_at: done ? (typeof entry.completed_at === 'string' ? entry.completed_at : now) : null,
      closed_at: done ? (typeof entry.closed_at === 'string' ? entry.closed_at : now) : null,
    };
  });
}
