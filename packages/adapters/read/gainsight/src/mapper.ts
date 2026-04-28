// Gainsight → canonical mapper.
//
// Source: Glean documents from `app:gainsight` with `type:calltoaction`.
// Each doc is one Gainsight CTA (Call-to-Action / Risk task).
//
// What Glean exposes for CTA docs (matchingFilters, lowercase):
//   - gscompanygsid: Gainsight internal company ID (not SFDC)
//   - gscompanyname: account name (used for SFDC join via name match)
//   - gsctaname: CTA title, e.g. "GitLab, Inc. Low Utilization"
//   - gsctaownername: owner's display name (CSE/CSM/AE)
//   - gsctapriority: Low / Medium / High
//   - gsctastatus: New / Work In Progress / Closed Invalid / Closed Successful
//   - gsctatype: Risk / Expansion / Onboarding / Lifecycle
//   - gssource: Rules / Manual / Gainsight Integration
//
// Snippets carry the unstructured text representation of additional
// fields that don't appear as facets:
//   - Due Date: <ISO timestamp>
//   - Created Date: <ISO timestamp>
//   - Closed Date Time: <ISO timestamp>
//   - Total Task Count / Closed Task Count
//   - Percent Complete
//
// Cross-system join: Gainsight does NOT expose the SFDC Account ID via
// Glean facets — only the Gainsight GSID and the company name. The
// adapter joins via case-insensitive name match against the prior
// snapshot's CanonicalAccount.accountName (with light normalization).
// Unmatched CTAs are dropped (logged at info level).
import type { GainsightTask } from '@mdas/canonical';
import type { GleanDocument } from '../../_shared/src/glean.js';

/** Strip a leading/trailing snippet token like "Subject: " or "Type: ". */
function snippetField(snippets: string[] | undefined, label: string): string | null {
  if (!snippets) return null;
  for (const s of snippets) {
    const re = new RegExp(`^${label}\\s*:\\s*(.+?)\\s*$`, 'i');
    const m = s.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function firstFilter(doc: GleanDocument, key: string): string | null {
  const v = doc.matchingFilters?.[key]?.[0];
  return v ?? null;
}

/** Normalize a company name for fuzzy join: lowercase, drop trailing
 *  ", Inc.", ", LLC", "GmbH", and punctuation. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/,\s*(inc\.?|llc|ltd\.?|gmbh|sa|s\.a\.|corp\.?|corporation|co\.?)\b/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface GainsightCtaMapped {
  /** Account name as Gainsight reports it — used to join to canonical. */
  companyName: string;
  /** Normalized name (lowercase, suffix-stripped) for the join. */
  normalizedName: string;
  task: GainsightTask;
  /** Gainsight CTA URL for the SourceLink emitted by the adapter. */
  url: string | null;
  /** ISO timestamp Glean reports for last activity. */
  ctaIndexedAt: string | null;
  /** True when CTA is in a non-terminal state (relevant for the canonical surface). */
  isOpen: boolean;
}

const CLOSED_STATUSES = new Set([
  'closed',
  'closed successful',
  'closed invalid',
  'closed lost',
]);

/**
 * Map one Gainsight CTA Glean document to a normalized record. Returns
 * null if essential fields (company name, CTA name) are absent — we'd
 * rather drop a malformed doc than emit a half-populated GainsightTask.
 */
export function mapGainsightCta(doc: GleanDocument): GainsightCtaMapped | null {
  const companyName = firstFilter(doc, 'gscompanyname') ?? doc.title?.split(' — ').pop() ?? null;
  const ctaName =
    firstFilter(doc, 'gsctaname') ?? snippetField(doc.snippets, 'Name') ?? doc.title ?? null;
  if (!companyName || !ctaName) return null;

  const ownerName = firstFilter(doc, 'gsctaownername');
  const status = firstFilter(doc, 'gsctastatus') ?? 'Unknown';
  const dueDate = snippetField(doc.snippets, 'Due Date');
  const createdDate = snippetField(doc.snippets, 'Created Date');
  const ctaIdFromUrl = doc.url?.match(/\/cta\/([A-Z0-9]+)/i)?.[1] ?? null;

  const task: GainsightTask = {
    id: ctaIdFromUrl ?? `gs:${normalizeName(companyName)}:${normalizeName(ctaName)}`,
    title: ctaName,
    owner: ownerName ? { id: ownerName, name: ownerName } : null,
    dueDate: dueDate ?? null,
    status,
    ctaId: ctaIdFromUrl,
  };

  return {
    companyName,
    normalizedName: normalizeName(companyName),
    task,
    url: doc.url ?? null,
    ctaIndexedAt: createdDate ?? doc.updateTime ?? null,
    isOpen: !CLOSED_STATUSES.has(status.toLowerCase()),
  };
}
