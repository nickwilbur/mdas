// account-context: fetches account plans / decks / QBR documents per
// account from Glean's gdrive datasource. Populates
// CanonicalAccount.accountPlanLinks for the Account Drill-In's
// "Account Plans & Docs" section.
//
// Strategy:
//   - One Glean search per account (two when cold: combined plan+QBR query;
//     warm accounts with ≥2 prior links use primary query only).
//   - Take the top N results (default 5) sorted by Glean's relevance score.
//   - Each result becomes an `accountPlanLinks` entry with title, url,
//     lastModified.
//   - SourceLink with citationId/snippetIndex captured for the drill-in
//     deep links per the citation discipline (Section 2.4).
import type { CanonicalAccount, SourceLink } from '@mdas/canonical';
import type { GleanClient, GleanDocument } from '../../_shared/src/glean.js';

export interface AccountContextInput {
  accountId: string;
  accountName: string;
  /**
   * Number of plan links this account already has in the prior snapshot.
   * Used to skip the secondary QBR/business-review query when the account
   * already has well-populated plan coverage — the primary "<name> account
   * plan" query is sufficient to refresh metadata on existing links and
   * we save 1 Glean call per warm account (~20% of glean-mcp's work).
   * Cold accounts (priorPlanLinks < 2) still get both queries.
   */
  priorPlanLinks?: number;
}

export interface AccountContextOutput {
  accountPlanLinks: NonNullable<CanonicalAccount['accountPlanLinks']>;
  sourceLinks: SourceLink[];
}

export interface AccountContextOptions {
  /** How many top docs to keep per account. Default 5. */
  topN?: number;
  /** Override the search query template (used for testing). */
  buildQuery?: (accountName: string) => string;
}

// Glean's MCP `search` tool requires SHORT keyword queries — no quotes,
// no boolean operators, no full sentences. Per Glean's tool description.
// Two queries cover the common doc shapes; we run both per account and
// dedupe by URL downstream.
// Combined cold query replaces separate primary + secondary when bootstrapping.
const DEFAULT_QUERY = (accountName: string): string =>
  `${accountName} account plan`;
const COMBINED_COLD_QUERY = (accountName: string): string =>
  `${accountName} account plan QBR review`;

const PLAN_KEYWORDS = [
  'account plan',
  'qbr',
  'business review',
  'success plan',
  'plan',
  'review',
];

function looksLikePlanDoc(doc: GleanDocument): boolean {
  const title = (doc.title ?? '').toLowerCase();
  return PLAN_KEYWORDS.some((kw) => title.includes(kw));
}

function toPlanLink(doc: GleanDocument): { title: string; url: string; lastModified: string } | null {
  if (!doc.url) return null;
  return {
    title: doc.title ?? doc.url,
    url: doc.url,
    lastModified: doc.updateTime ?? doc.createTime ?? '',
  };
}

function toSourceLink(doc: GleanDocument): SourceLink | null {
  if (!doc.url) return null;
  return {
    source: 'glean',
    label: doc.title ?? 'Account Plan',
    url: doc.url,
    ...(doc.citationId ? { citationId: doc.citationId } : {}),
    ...(typeof doc.snippetIndex === 'number' ? { snippetIndex: doc.snippetIndex } : {}),
  };
}

/**
 * Fetch account context (plans, decks, QBRs) for a single account.
 * Returns a `Partial<CanonicalAccount>` shaped output the caller merges
 * into the Account record.
 */
export async function fetchAccountContext(
  client: GleanClient,
  input: AccountContextInput,
  opts: AccountContextOptions = {},
): Promise<AccountContextOutput> {
  const topN = opts.topN ?? 5;
  const buildQuery = opts.buildQuery ?? DEFAULT_QUERY;

  // Cold accounts: one combined plan+QBR query. Warm accounts (≥2 prior
  // plan links): primary query only — enough to refresh metadata on links.
  const SECONDARY_SKIP_THRESHOLD = 2;
  const includeSecondary =
    !opts.buildQuery && (input.priorPlanLinks ?? 0) < SECONDARY_SKIP_THRESHOLD;
  const queries = includeSecondary
    ? [COMBINED_COLD_QUERY(input.accountName)]
    : [buildQuery(input.accountName)];

  const allDocs: GleanDocument[] = [];
  for (const q of queries) {
    try {
      const resp = await client.search({ query: q });
      const docs = resp.documents ?? resp.results ?? [];
      allDocs.push(...docs);
    } catch {
      // Glean failures here are non-fatal; account-context is enrichment.
    }
  }

  // Dedupe by URL and prefer Google Drive results when present (highest
  // signal-to-noise for account plans).
  const seenUrls = new Set<string>();
  const deduped: GleanDocument[] = [];
  for (const d of allDocs) {
    if (!d.url || seenUrls.has(d.url)) continue;
    seenUrls.add(d.url);
    deduped.push(d);
  }
  // Sort: gdrive first, then any plan-shaped, then everything else.
  deduped.sort((a, b) => {
    const aGd = (a.datasource ?? '').includes('drive') ? 0 : 1;
    const bGd = (b.datasource ?? '').includes('drive') ? 0 : 1;
    return aGd - bGd;
  });

  // Filter to plan-shaped documents (by title keyword) and keep top N.
  const planLikeDocs = deduped.filter(looksLikePlanDoc).slice(0, topN);

  const accountPlanLinks = planLikeDocs
    .map(toPlanLink)
    .filter((link): link is { title: string; url: string; lastModified: string } => link !== null);
  const sourceLinks = planLikeDocs
    .map(toSourceLink)
    .filter((sl): sl is SourceLink => sl !== null);

  return { accountPlanLinks, sourceLinks };
}
