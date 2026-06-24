import type { CTAOwner, CTALogEntry, CTARecord } from './types.js';
import { dedupKey } from './suppress.js';

/** Canonical progress statuses for MDAS CTA tracking. */
export type CTAProgressStatus = 'open' | 'in_progress' | 'blocked' | 'done';

export const CTA_PROGRESS_STATUSES: CTAProgressStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'done',
];

export const CTA_PROGRESS_STATUS_LABELS: Record<CTAProgressStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};

const LEGACY_STATUS_MAP: Record<string, CTAProgressStatus> = {
  open: 'open',
  in_progress: 'in_progress',
  blocked: 'blocked',
  done: 'done',
  closed_done: 'done',
  stalled: 'blocked',
};

/** Normalize legacy and current status strings to the canonical set. */
export function normalizeCtaStatus(status: string | undefined | null): CTAProgressStatus {
  if (!status) return 'open';
  return LEGACY_STATUS_MAP[status] ?? 'open';
}

export function isCtaOpen(status: string | undefined | null): boolean {
  const normalized = normalizeCtaStatus(status);
  return normalized !== 'done';
}

export function ownerDisplayName(owner: CTAOwner | string | null | undefined): string {
  if (!owner) return 'Unassigned';
  return typeof owner === 'string' ? owner : owner.name;
}

/** Effective owner — explicit assignment overrides generated primary_owner. */
export function effectiveCtaOwner(entry: Pick<CTALogEntry, 'assigned_owner' | 'primary_owner'>): string {
  if (entry.assigned_owner) return ownerDisplayName(entry.assigned_owner);
  return ownerDisplayName(entry.primary_owner);
}

export function effectiveCtaDueDate(entry: Pick<CTALogEntry, 'due_date' | 'deadline'>): string | null {
  return entry.due_date ?? entry.deadline ?? null;
}

export interface OpportunityAccountLookup {
  opportunityId: string;
  accountId: string;
}

/** Extract SFDC opportunity id from a Lightning / classic opportunity URL. */
export function extractOpportunityIdFromSalesforceUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const match = url.match(/\/Opportunity\/([a-zA-Z0-9]{15,18})(?:\/|$|\?)/i)
    ?? url.match(/\/Opportunity\/([a-zA-Z0-9]+)/i);
  const id = match?.[1] ?? null;
  if (!id || id.length < 15) return null;
  return id;
}

/**
 * Resolve the canonical renewal opportunity id for a CTA.
 * Prefers explicit renewal_opportunity_id; falls back to URL parsing.
 */
export function resolveRenewalOpportunityId(
  cta: Pick<CTARecord, 'renewal_opportunity_id' | 'renewal_opportunity_url'>,
): string | null {
  if (cta.renewal_opportunity_id) return cta.renewal_opportunity_id;
  return extractOpportunityIdFromSalesforceUrl(cta.renewal_opportunity_url);
}

/**
 * Enrich a legacy log entry with renewal_opportunity_id and opportunity-scoped dedup_key.
 */
export function enrichCtaLogEntry<
  T extends Pick<
    CTARecord,
    | 'renewal_opportunity_id'
    | 'renewal_opportunity_url'
    | 'salesforce_account_id'
    | 'play_type'
    | 'dedup_key'
  >,
>(
  entry: T,
): T & { renewal_opportunity_id: string | null; dedup_key: string } {
  const renewal_opportunity_id = resolveRenewalOpportunityId(entry);
  const nextDedupKey = dedupKey(
    entry.salesforce_account_id ?? null,
    entry.play_type,
    renewal_opportunity_id,
  );
  return {
    ...entry,
    renewal_opportunity_id,
    dedup_key: nextDedupKey,
  };
}

/**
 * Derive account id from the linked renewal opportunity when present.
 * Falls back to salesforce_account_id only when no opportunity is linked.
 */
export function deriveCtaAccountId(
  cta: Pick<CTARecord, 'renewal_opportunity_id' | 'renewal_opportunity_url' | 'salesforce_account_id'>,
  opportunities: OpportunityAccountLookup[],
): string | null {
  const oppId = resolveRenewalOpportunityId(cta);
  if (oppId) {
    const opp = opportunities.find((o) => o.opportunityId === oppId);
    return opp?.accountId ?? null;
  }
  return cta.salesforce_account_id;
}

export interface CtaOppSummary {
  ctaId: string;
  playType: string;
  status: CTAProgressStatus;
  ownerName: string;
  dueDate: string | null;
  progressNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  renewalOpportunityId: string;
  accountId: string;
}

export interface RenewalRowWithCta<T> {
  row: T;
  cta: CtaOppSummary | null;
}

function toSummary(
  entry: CTALogEntry,
  accountId: string,
): CtaOppSummary {
  return {
    ctaId: entry.cta_id,
    playType: entry.play_type,
    status: normalizeCtaStatus(entry.status),
    ownerName: effectiveCtaOwner(entry),
    dueDate: effectiveCtaDueDate(entry),
    progressNote: entry.progress_note ?? null,
    createdAt: entry.created_at ?? entry.posted_at ?? null,
    updatedAt: entry.updated_at ?? entry.last_checked_at ?? null,
    completedAt:
      entry.completed_at ??
      (normalizeCtaStatus(entry.status) === 'done' ? entry.closed_at ?? null : null),
    renewalOpportunityId: resolveRenewalOpportunityId(entry) ?? '',
    accountId,
  };
}

/**
 * Index open CTAs by renewal opportunity id (newest updated first per opp).
 */
export function indexCtasByOpportunityId(
  ctas: CTALogEntry[],
  opportunities: OpportunityAccountLookup[],
): Map<string, CtaOppSummary> {
  const byOpp = new Map<string, CtaOppSummary>();

  const sorted = [...ctas].sort((a, b) => {
    const au = a.updated_at ?? a.last_checked_at ?? a.posted_at ?? '';
    const bu = b.updated_at ?? b.last_checked_at ?? b.posted_at ?? '';
    return bu.localeCompare(au);
  });

  for (const entry of sorted) {
    const oppId = resolveRenewalOpportunityId(entry);
    if (!oppId || byOpp.has(oppId)) continue;
    if (!isCtaOpen(entry.status)) continue;

    const accountId = deriveCtaAccountId(entry, opportunities);
    if (!accountId) continue;

    byOpp.set(oppId, toSummary(entry, accountId));
  }

  return byOpp;
}

/**
 * Attach the primary open CTA to each renewal opportunity row.
 */
export function attachCtasToRenewalRows<T extends { opportunityId: string; accountId: string }>(
  rows: T[],
  ctas: CTALogEntry[],
): Array<T & { cta: CtaOppSummary | null }> {
  const opportunities: OpportunityAccountLookup[] = rows.map((r) => ({
    opportunityId: r.opportunityId,
    accountId: r.accountId,
  }));
  const byOpp = indexCtasByOpportunityId(ctas, opportunities);

  return rows.map((row) => ({
    ...row,
    cta: byOpp.get(row.opportunityId) ?? null,
  }));
}

function dedupKeyForEntry(entry: Pick<CTARecord, 'dedup_key' | 'salesforce_account_id' | 'play_type' | 'renewal_opportunity_id' | 'renewal_opportunity_url'>): string {
  return (
    entry.dedup_key ??
    dedupKey(
      entry.salesforce_account_id ?? null,
      entry.play_type,
      resolveRenewalOpportunityId(entry),
    )
  );
}

/** Index log entries by dedup key (newest posted_at wins). */
export function indexCtaLogByDedupKey(
  entries: Iterable<CTALogEntry>,
): Map<string, CTALogEntry> {
  const byKey = new Map<string, CTALogEntry>();
  for (const entry of entries) {
    const key = dedupKeyForEntry(entry);
    const existing = byKey.get(key);
    if (!existing || entry.posted_at > existing.posted_at) {
      byKey.set(key, entry);
    }
  }
  return byKey;
}

/**
 * Carry user progress fields from a prior log entry onto a freshly generated one.
 * Matches by dedup key so full-scan regeneration does not reset status/notes.
 */
export function carryForwardCtaProgress(
  fresh: CTALogEntry,
  priorByDedupKey: Map<string, CTALogEntry>,
): CTALogEntry {
  const prior = priorByDedupKey.get(dedupKeyForEntry(fresh));
  if (!prior) return fresh;

  return {
    ...fresh,
    status: prior.status,
    assigned_owner: prior.assigned_owner ?? null,
    due_date: prior.due_date ?? fresh.due_date ?? null,
    progress_note: prior.progress_note ?? null,
    created_at: prior.created_at ?? prior.posted_at ?? fresh.created_at,
    updated_at: prior.updated_at ?? fresh.updated_at,
    completed_at: prior.completed_at ?? null,
    closed_at: prior.closed_at ?? null,
    last_checked_at: prior.last_checked_at ?? fresh.last_checked_at,
  };
}
