// evidence: aggregates per-account cross-source signals from Glean —
// recent calendar meetings, Slack mentions, Staircase email summaries,
// and (with privacy guards) Gmail subject lines.
//
// Output: CanonicalAccount.recentMeetings (typed as MeetingSummary[]).
//
// Privacy: per Section 2.3 of the refactor prompt, Gmail messages must
// not have their bodies retrieved for accounts not owned by the current
// user. The current MDAS worker has no per-user identity, so we apply
// the strictest interpretation: never call getDocument() on Gmail docs;
// rely on the snippet/title that Glean's search response already
// returned (which Glean has access-checked at index time).
//
// Strategy:
//   - Calendar + Gmail: one search each, client-side datasource filter.
//   - Slack: multiple keyword queries (channel id, slug, name token)
//     with paginated searchAll — Glean MCP search is cross-datasource
//     and a single query often buries Slack hits below unrelated docs.
//   - Bot/join noise filtered at ingest so human posts aren't displaced
//     by the per-source cap.
import type { CanonicalAccount, MeetingSummary, SourceLink } from '@mdas/canonical';
import { mergeRecentMeetings } from '@mdas/canonical';
import { isAutomatedSlackMessage, parseSlackUrl, slugifyAccountName } from '@mdas/slack-send';
import type { GleanClient, GleanDocument } from '../../_shared/src/glean.js';

export interface EvidenceInput {
  accountId: string;
  accountName: string;
  /** Mapped customer Slack channel from Salesforce (when known). */
  salesforceSlackChannelUrl?: string | null;
}

export interface EvidenceOutput {
  recentMeetings: MeetingSummary[];
  sourceLinks: SourceLink[];
}

export interface EvidenceOptions {
  /** Per-source top-N for calendar/gmail. Default 3. */
  topNPerSource?: number;
  /** Days back to consider "recent" for calendar/gmail. Default 30. */
  recencyDays?: number;
  /** Slack uses a longer window — channels are checked less often in UI. Default 90. */
  slackRecencyDays?: number;
  /** Max human Slack posts retained after multi-query fetch. Default 50. */
  maxSlackHumanPosts?: number;
}

const SLACK_PREFIX = 'slack';
const CAL_PREFIX = 'calendar';
const STAIRCASE_PREFIX = 'staircase';

const DEFAULT_SLACK_RECENCY_DAYS = 90;
const DEFAULT_MAX_SLACK_HUMAN_POSTS = 50;
/** Pages per Slack query — each page is one Glean MCP search call. */
function resolveSlackSearchMaxPages(): number {
  const n = Number(process.env.GLEAN_SLACK_SEARCH_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

interface SourceConfig {
  /** Glean datasource id. */
  datasource: string;
  /** Logical bucket emitted to MeetingSummary.source. */
  bucket: 'calendar' | 'zoom' | 'staircase';
  /** Mode: full doc (title + summary) vs metadata-only (privacy guard). */
  fullDoc: boolean;
  /** Per-account search query template. */
  buildQuery: (input: EvidenceInput) => string;
}

function mappedSlackChannelId(input: EvidenceInput): string | null {
  return parseSlackUrl(input.salesforceSlackChannelUrl ?? null)?.channelId ?? null;
}

/** Primary slug token for matching Glean hits to an account (e.g. kustomer). */
function primaryAccountToken(accountName: string): string | null {
  const slug = slugifyAccountName(accountName);
  if (!slug) return null;
  return slug.replace(/^cust-/, '');
}

function docBlob(doc: GleanDocument): string {
  return `${doc.title ?? ''} ${(doc.snippets ?? []).join(' ')} ${doc.url ?? ''}`.toLowerCase();
}

/**
 * Drop cross-account noise from Glean keyword search. Without this,
 * queries like "Kustomer renewal risk escalation" can surface unrelated
 * Staircase summaries for other customers.
 */
export function docMatchesAccount(
  doc: GleanDocument,
  input: EvidenceInput,
  datasource: string,
): boolean {
  const blob = docBlob(doc);
  const channelId = mappedSlackChannelId(input);
  const channelSlug = slugifyAccountName(input.accountName);

  if (datasource === 'slack') {
    if (channelId) {
      const docChannelId = parseSlackUrl(doc.url ?? null)?.channelId;
      if (docChannelId === channelId) return true;
      if ((doc.url ?? '').includes(channelId)) return true;
    }
    if (channelSlug && blob.includes(channelSlug)) return true;
    return false;
  }

  const token = primaryAccountToken(input.accountName);
  if (!token || token.length < 3) return true;
  return blob.includes(token);
}

/**
 * Datasources we pull cross-source evidence from. Gmail entries (when
 * present in Glean) are deliberately routed via metadata-only mode —
 * we use the snippet returned by search but never call getDocument()
 * on the underlying message. This is the privacy guard for accounts the
 * current user doesn't own.
 *
 * Slack is handled separately via fetchSlackChannelDocs() — see above.
 */
const NON_SLACK_SOURCES: SourceConfig[] = [
  {
    datasource: 'googlecalendar',
    bucket: 'calendar',
    fullDoc: true,
    buildQuery: (input) => {
      const token = primaryAccountToken(input.accountName) ?? input.accountName;
      return `${token} renewal QBR review`;
    },
  },
  {
    datasource: 'gmail',
    bucket: 'staircase', // Staircase summaries arrive via Gmail.
    fullDoc: false, // PRIVACY: never read Gmail bodies.
    buildQuery: (input) => {
      const token = primaryAccountToken(input.accountName) ?? input.accountName;
      return `${token} staircase summary`;
    },
  },
];

const SLACK_SOURCE: SourceConfig = {
  datasource: 'slack',
  bucket: 'calendar', // Slack mentions surface as evidence; logical bucket "calendar" is closest in the canonical type's union.
  fullDoc: false,
  buildQuery: (input) => {
    const channelId = mappedSlackChannelId(input);
    if (channelId) return channelId;
    const slug = slugifyAccountName(input.accountName);
    if (slug) return slug;
    const token = primaryAccountToken(input.accountName);
    return token ? `${token} slack` : `${input.accountName} slack`;
  },
};

function normalizeStartTime(doc: GleanDocument): string {
  return doc.updateTime ?? doc.createTime ?? new Date().toISOString();
}

function extractAttendees(doc: GleanDocument): string[] {
  const mf = doc.matchingFilters ?? {};
  // Glean's calendar connector commonly exposes participants as a facet.
  const fromFacets = mf['participants'] ?? mf['attendees'] ?? [];
  return Array.from(new Set(fromFacets));
}

function buildSummary(doc: GleanDocument, fullDoc: boolean): string | null {
  if (!fullDoc) {
    // Metadata-only: title + (truncated) first snippet.
    const snippet = doc.snippets?.[0]?.slice(0, 240) ?? null;
    return snippet ?? null;
  }
  const snippet = doc.snippets?.[0] ?? null;
  return snippet;
}

function toMeetingSummary(doc: GleanDocument, source: SourceConfig): MeetingSummary | null {
  if (!doc.url) return null;
  return {
    source: source.bucket,
    title: doc.title ?? `${source.datasource} item`,
    startTime: normalizeStartTime(doc),
    attendees: extractAttendees(doc),
    summary: buildSummary(doc, source.fullDoc),
    url: doc.url,
  };
}

function toSourceLink(doc: GleanDocument, source: SourceConfig): SourceLink | null {
  if (!doc.url) return null;
  // Map Glean datasource → canonical SourceLink origin.
  const sourceMap: Record<string, SourceLink['source']> = {
    googlecalendar: 'calendar',
    slack: 'slack',
    gmail: 'gmail',
    gdrive: 'glean',
  };
  return {
    source: sourceMap[source.datasource] ?? 'glean',
    label: doc.title ?? source.datasource,
    url: doc.url,
    ...(doc.citationId ? { citationId: doc.citationId } : {}),
    ...(typeof doc.snippetIndex === 'number' ? { snippetIndex: doc.snippetIndex } : {}),
  };
}

function isRecent(doc: GleanDocument, recencyDays: number): boolean {
  const ts = doc.updateTime ?? doc.createTime;
  if (!ts) return true; // No timestamp → fail-open and let Glean's relevance filter
  const age = Date.now() - new Date(ts).getTime();
  return age <= recencyDays * 24 * 60 * 60 * 1000;
}

function docRecencyMs(doc: GleanDocument): number {
  const ts = doc.updateTime ?? doc.createTime;
  return ts ? Date.parse(ts) : 0;
}

function docIsSlackSource(doc: GleanDocument): boolean {
  if (doc.datasource === 'slack') return true;
  const apps = doc.matchingFilters?.app ?? [];
  return apps.some((a) => a === 'slack');
}

function isAutomatedSlackDoc(doc: GleanDocument): boolean {
  const title = doc.title ?? '';
  const summary = doc.snippets?.[0] ?? null;
  return isAutomatedSlackMessage(title, summary);
}

/** Distinct Slack search queries — channel id first when mapped. */
export function buildSlackSearchQueries(input: EvidenceInput): string[] {
  const channelId = mappedSlackChannelId(input);
  // When Salesforce maps a customer channel, a single channel-id query is
  // precise enough (docMatchesAccount filters by id). Extra slug/token
  // queries were ~3 redundant paginated searches per account.
  if (channelId) return [channelId];

  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (q: string | null | undefined) => {
    const trimmed = q?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    queries.push(trimmed);
  };

  const slug = slugifyAccountName(input.accountName);
  if (slug) {
    add(slug);
    add(slug.replace(/^cust-/, ''));
  }
  const token = primaryAccountToken(input.accountName);
  if (token && token.length >= 3) add(`${token} slack`);
  if (queries.length === 0) add(SLACK_SOURCE.buildQuery(input));
  return queries;
}

/**
 * Paginated, multi-query Slack fetch. Glean MCP search is cross-datasource
 * and single-query retrieval routinely misses indexed channel posts.
 */
export async function fetchSlackChannelDocs(
  client: GleanClient,
  input: EvidenceInput,
  recencyDays: number,
  maxHumanPosts: number,
): Promise<GleanDocument[]> {
  const byUrl = new Map<string, GleanDocument>();
  const queries = buildSlackSearchQueries(input);
  const maxPages = resolveSlackSearchMaxPages();

  // Run queries sequentially so we can stop once the cap is met — avoids
  // firing 3–4 parallel paginated searches when the first query suffices.
  for (const query of queries) {
    if (byUrl.size >= maxHumanPosts) break;
    try {
      const docs = await client.searchAll({ query }, maxPages);
      for (const doc of docs) {
        if (!doc.url || byUrl.has(doc.url)) continue;
        if (!docIsSlackSource(doc)) continue;
        if (!isRecent(doc, recencyDays)) continue;
        if (!docMatchesAccount(doc, input, 'slack')) continue;
        if (isAutomatedSlackDoc(doc)) continue;
        byUrl.set(doc.url, doc);
        if (byUrl.size >= maxHumanPosts) break;
      }
    } catch {
      // Per-query failure is non-fatal — other queries may succeed.
    }
  }

  return [...byUrl.values()]
    .sort((a, b) => docRecencyMs(b) - docRecencyMs(a))
    .slice(0, maxHumanPosts);
}

function docMatchesDatasource(doc: GleanDocument, datasource: string): boolean {
  if (doc.datasource === datasource) return true;
  const apps = doc.matchingFilters?.app ?? [];
  return apps.some((a) => a === datasource);
}

/** One short query for calendar + gmail evidence (was two separate searches). */
export function buildCombinedNonSlackQuery(input: EvidenceInput): string {
  const token = primaryAccountToken(input.accountName) ?? input.accountName;
  return `${token} renewal QBR staircase review`;
}

async function fetchCombinedNonSlackDocs(
  client: GleanClient,
  input: EvidenceInput,
  recencyDays: number,
  topN: number,
): Promise<GleanDocument[][]> {
  try {
    const resp = await client.search({ query: buildCombinedNonSlackQuery(input) });
    const docs = resp.documents ?? resp.results ?? [];
    return NON_SLACK_SOURCES.map((source) =>
      docs
        .filter((d) => docMatchesDatasource(d, source.datasource))
        .filter((d) => isRecent(d, recencyDays))
        .filter((d) => docMatchesAccount(d, input, source.datasource))
        .sort((a, b) => docRecencyMs(b) - docRecencyMs(a))
        .slice(0, topN),
    );
  } catch {
    return NON_SLACK_SOURCES.map(() => []);
  }
}

/**
 * Fetch cross-source evidence (calendar, slack, staircase) for one account.
 * Slack uses dedicated multi-query pagination; calendar + gmail share one search.
 */
export async function fetchAccountEvidence(
  client: GleanClient,
  input: EvidenceInput,
  opts: EvidenceOptions = {},
): Promise<EvidenceOutput> {
  const topN = opts.topNPerSource ?? 3;
  const recencyDays = opts.recencyDays ?? 30;
  const slackRecencyDays = opts.slackRecencyDays ?? Math.max(recencyDays, DEFAULT_SLACK_RECENCY_DAYS);
  const maxSlackHumanPosts = opts.maxSlackHumanPosts ?? DEFAULT_MAX_SLACK_HUMAN_POSTS;

  const [slackDocs, combinedDocs] = await Promise.all([
    fetchSlackChannelDocs(client, input, slackRecencyDays, maxSlackHumanPosts),
    fetchCombinedNonSlackDocs(client, input, recencyDays, topN),
  ]);
  const otherSourceDocs = combinedDocs;

  const perSource: { source: SourceConfig; docs: GleanDocument[] }[] = [
    { source: SLACK_SOURCE, docs: slackDocs },
    ...NON_SLACK_SOURCES.map((source, i) => ({
      source,
      docs: otherSourceDocs[i] ?? [],
    })),
  ];

  const recentMeetings: MeetingSummary[] = [];
  const sourceLinks: SourceLink[] = [];
  for (const { source, docs } of perSource) {
    for (const doc of docs) {
      const m = toMeetingSummary(doc, source);
      if (m) recentMeetings.push(m);
      const sl = toSourceLink(doc, source);
      if (sl) sourceLinks.push(sl);
    }
  }

  // Reference the SLACK_PREFIX/CAL_PREFIX/STAIRCASE_PREFIX exports so they
  // remain available for downstream consumers (kept for symmetry / future
  // typed bucket discriminators).
  void SLACK_PREFIX;
  void CAL_PREFIX;
  void STAIRCASE_PREFIX;

  return { recentMeetings, sourceLinks };
}

/**
 * Apply an evidence + context output to a CanonicalAccount partial in
 * place. Helper used by the adapter wiring — keeps the merge concerns
 * close to the data shapes they touch.
 */
export function applyContextAndEvidenceToAccount(
  patch: Partial<CanonicalAccount>,
  context: { accountPlanLinks: NonNullable<CanonicalAccount['accountPlanLinks']>; sourceLinks: SourceLink[] },
  evidence: EvidenceOutput,
  refreshAt: Date,
  priorMeetings?: MeetingSummary[],
): void {
  if (context.accountPlanLinks.length > 0) patch.accountPlanLinks = context.accountPlanLinks;
  const mergedMeetings = mergeRecentMeetings(priorMeetings, evidence.recentMeetings);
  if (mergedMeetings.length > 0) patch.recentMeetings = mergedMeetings;
  const combined = [...context.sourceLinks, ...evidence.sourceLinks];
  if (combined.length > 0) patch.sourceLinks = combined;
  patch.lastFetchedFromSource = {
    ...(patch.lastFetchedFromSource ?? {}),
    'glean-mcp': refreshAt.toISOString(),
  };
}
