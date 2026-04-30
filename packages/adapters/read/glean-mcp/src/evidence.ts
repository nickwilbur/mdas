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
//   - One search per source per account, scoped via datasourcesFilter.
//   - Each result is normalized into a MeetingSummary entry.
//   - Top-N per source (default 3), so a noisy account doesn't blow out
//     the canonical record.
import type { CanonicalAccount, MeetingSummary, SourceLink } from '@mdas/canonical';
import type { GleanClient, GleanDocument } from '../../_shared/src/glean.js';

export interface EvidenceInput {
  accountId: string;
  accountName: string;
}

export interface EvidenceOutput {
  recentMeetings: MeetingSummary[];
  sourceLinks: SourceLink[];
}

export interface EvidenceOptions {
  /** Per-source top-N. Default 3. */
  topNPerSource?: number;
  /** Days back to consider "recent". Default 30. */
  recencyDays?: number;
}

const SLACK_PREFIX = 'slack';
const CAL_PREFIX = 'calendar';
const STAIRCASE_PREFIX = 'staircase';

interface SourceConfig {
  /** Glean datasource id. */
  datasource: string;
  /** Logical bucket emitted to MeetingSummary.source. */
  bucket: 'calendar' | 'zoom' | 'staircase';
  /** Mode: full doc (title + summary) vs metadata-only (privacy guard). */
  fullDoc: boolean;
  /** Per-account search query template. */
  buildQuery: (accountName: string) => string;
}

/**
 * Datasources we pull cross-source evidence from. Gmail entries (when
 * present in Glean) are deliberately routed via metadata-only mode —
 * we use the snippet returned by search but never call getDocument()
 * on the underlying message. This is the privacy guard for accounts the
 * current user doesn't own.
 */
// Glean's MCP `search` tool requires SHORT keyword queries — no quotes,
// no boolean operators, no advanced filters like `from:`. Per Glean's
// tool description. We use plain keyword combinations and rely on
// downstream datasource-filtering of returned docs.
const SOURCES: SourceConfig[] = [
  {
    datasource: 'googlecalendar',
    bucket: 'calendar',
    fullDoc: true,
    buildQuery: (n) => `${n} renewal QBR review`,
  },
  {
    datasource: 'slack',
    bucket: 'calendar', // Slack mentions surface as evidence; logical bucket "calendar" is closest in the canonical type's union.
    fullDoc: false,
    buildQuery: (n) => `${n} renewal risk escalation`,
  },
  {
    datasource: 'gmail',
    bucket: 'staircase', // Staircase summaries arrive via Gmail.
    fullDoc: false, // PRIVACY: never read Gmail bodies.
    buildQuery: (n) => `${n} staircase summary`,
  },
];

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

/**
 * Fetch cross-source evidence (calendar, slack, staircase) for one account.
 * Issues SOURCES.length parallel searches and stitches the results into
 * a single recentMeetings array bounded by topNPerSource.
 */
export async function fetchAccountEvidence(
  client: GleanClient,
  input: EvidenceInput,
  opts: EvidenceOptions = {},
): Promise<EvidenceOutput> {
  const topN = opts.topNPerSource ?? 3;
  const recencyDays = opts.recencyDays ?? 30;

  const perSource = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const resp = await client.search({
          query: source.buildQuery(input.accountName),
        });
        const docs = resp.documents ?? resp.results ?? [];
        // MCP search returns cross-datasource results — filter to the
        // intended source. Datasource is reported on the top-level
        // `datasource` field for each doc; some Glean builds also
        // populate matchingFilters.app.
        const inSource = docs.filter((d) => {
          if (d.datasource === source.datasource) return true;
          const apps = d.matchingFilters?.app ?? [];
          return apps.some((a) => a === source.datasource);
        });
        const fresh = inSource
          .filter((d) => isRecent(d, recencyDays))
          .slice(0, topN);
        return { source, docs: fresh };
      } catch {
        return { source, docs: [] as GleanDocument[] };
      }
    }),
  );

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
): void {
  if (context.accountPlanLinks.length > 0) patch.accountPlanLinks = context.accountPlanLinks;
  if (evidence.recentMeetings.length > 0) patch.recentMeetings = evidence.recentMeetings;
  const combined = [...context.sourceLinks, ...evidence.sourceLinks];
  if (combined.length > 0) patch.sourceLinks = combined;
  patch.lastFetchedFromSource = {
    ...(patch.lastFetchedFromSource ?? {}),
    'glean-mcp': refreshAt.toISOString(),
  };
}
