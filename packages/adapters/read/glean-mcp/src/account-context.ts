// account-context: fetches account plans / decks / QBR documents per
// account from Glean's gdrive datasource. Populates
// CanonicalAccount.accountPlanLinks for the Account Drill-In's
// "Account Plans & Docs" section.
//
// Strategy:
//   - One Glean search per account, scoped to gdrive, query =
//     `"<accountName>" (account plan OR QBR OR business review OR plan)`.
//     This narrows to docs that mention the account by name AND are
//     plan-shaped (vs. invoices, contracts, generic spreadsheets).
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
const DEFAULT_QUERY = (accountName: string): string =>
  `${accountName} account plan`;
const SECONDARY_QUERY = (accountName: string): string =>
  `${accountName} QBR business review`;

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

  // Run two queries per account (plan-shaped + QBR/review-shaped) and
  // merge results. MCP search ignores datasource filters, so we get
  // cross-source results and rely on the title-keyword filter
  // downstream to scope to plan docs.
  const queries = [
    buildQuery(input.accountName),
    opts.buildQuery ? null : SECONDARY_QUERY(input.accountName),
  ].filter((q): q is string => !!q);

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
