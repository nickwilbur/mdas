// GleanClient — shared HTTP client for Glean REST API v1.
//
// Read-only by construction:
//   - Only exposes search() (POST /rest/api/v1/search) and getDocument()
//     (POST /rest/api/v1/getdocument). No createIndex / updateMetadata /
//     similar verbs are exported.
//   - All POSTs route through readOnlyGuard which only permits the search,
//     chat, getdocument, and documents endpoints (see _shared/index.ts).
//
// Auth: Bearer token via GLEAN_MCP_TOKEN env var. Token is treated as
// opaque — no refresh logic; if it expires the caller surfaces the 401
// via .ok / response shape.
//
// Per-refresh caching: each GleanClient instance is constructed inside
// the worker's runRefresh() loop (PR-1 RefreshContext), so its in-memory
// caches are scoped to a single refresh and discarded after.
import { readOnlyGuard } from './index.js';

export interface GleanCredentials {
  /** Bearer token from GLEAN_MCP_TOKEN. */
  token: string;
  /** Base URL, e.g., https://zuora-be.glean.com or https://api.glean.com. */
  baseUrl: string;
}

export interface GleanFacetFilter {
  fieldName: string;
  values: { value: string; relationType: 'EQUALS' | 'ID' }[];
}

export interface GleanSearchOptions {
  query: string;
  /** Glean datasource names to scope to, e.g. ['cerebro']. */
  datasources?: string[];
  /** Field-name + value facet filters (logical AND across fields). */
  facetFilters?: GleanFacetFilter[];
  /** Page size, max ~100 per Glean docs. */
  pageSize?: number;
  /** Pagination cursor returned by a prior search. */
  cursor?: string;
}

export interface GleanMatchingFilters {
  [fieldName: string]: string[];
}

export interface GleanDocument {
  id?: string;
  title?: string;
  datasource?: string;
  url?: string;
  updateTime?: string;
  createTime?: string;
  snippets?: string[];
  matchingFilters?: GleanMatchingFilters;
  richDocumentData?: {
    content?: string;
    mimeType?: string;
    status?: string;
  };
  /** When present, Glean returns a citation tuple usable for deep-linking. */
  citationId?: string;
  snippetIndex?: number;
  percentRetrieved?: string;
}

export interface GleanSearchResponse {
  results?: GleanDocument[];
  documents?: GleanDocument[];
  cursor?: string;
  hasMoreResults?: boolean;
}

export interface GleanReadDocumentResponse {
  documents?: GleanDocument[];
}

// ---------------------------------------------------------------------------
// Chat (assistant) types — POST /rest/api/v1/chat
//
// Glean's assistant returns a `messages: ChatMessage[]` stream where each
// message has a list of `fragments` (text or citation references).
// We surface the minimum shape needed for in-app rendering: the assembled
// assistant text plus parallel citation metadata.
// ---------------------------------------------------------------------------
export interface GleanChatCitation {
  /** The cited document's title, when Glean attaches one. */
  title?: string;
  /** The cited document's URL — clickable in the UI. */
  url?: string;
  /** The cited document's datasource (e.g. 'gdrive'). */
  datasource?: string;
  /** Optional snippet that anchored the citation. */
  snippet?: string;
  /** Stable identifier Glean returns for trace/feedback. */
  citationId?: string;
}

export interface GleanChatMessage {
  /** 'USER' | 'GLEAN_AI' | 'SYSTEM' — Glean's role enum. */
  author?: string;
  /** Concatenation of all text fragments returned by Glean. */
  text: string;
  /** Citations extracted from `messageReferences` / fragment doc refs. */
  citations: GleanChatCitation[];
}

export interface GleanChatRequestMessage {
  author?: 'USER' | 'GLEAN_AI' | 'SYSTEM';
  fragments: { text: string }[];
}

export interface GleanChatOptions {
  /** Conversation so far, oldest first. The last message is typically USER. */
  messages: GleanChatRequestMessage[];
  /** When true, ask Glean for a stream — we currently buffer and return text. */
  stream?: boolean;
  /** Optional chat session id to thread follow-ups. */
  chatId?: string;
}

export interface GleanChatResponse {
  /** Full conversation echoed back including the new assistant reply. */
  messages?: Array<{
    author?: string;
    fragments?: Array<{
      text?: string;
      citation?: {
        sourceDocument?: GleanDocument;
        sourceFile?: GleanDocument;
      };
    }>;
    citations?: Array<{
      sourceDocument?: GleanDocument;
      sourceFile?: GleanDocument;
      snippet?: { text?: string };
    }>;
  }>;
  chatId?: string;
}

export class GleanClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  /** Per-refresh response cache keyed by URL. Avoids re-fetching the same
   *  document when multiple adapter codepaths reference it. */
  private readonly docCache = new Map<string, GleanDocument>();

  constructor(creds: GleanCredentials) {
    this.baseUrl = creds.baseUrl.replace(/\/$/, '');
    this.headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${creds.token}`,
    };
  }

  /**
   * Issue a POST /rest/api/v1/search call. Returns the raw response body —
   * callers narrow the document set themselves. Use searchAll() for
   * cursor-paginated full result retrieval.
   */
  async search(opts: GleanSearchOptions): Promise<GleanSearchResponse> {
    const body: Record<string, unknown> = {
      query: opts.query,
      pageSize: opts.pageSize ?? 100,
    };
    if (opts.cursor) body.cursor = opts.cursor;
    const requestOptions: Record<string, unknown> = {};
    if (opts.datasources?.length) requestOptions.datasourcesFilter = opts.datasources;
    if (opts.facetFilters?.length) requestOptions.facetFilters = opts.facetFilters;
    if (Object.keys(requestOptions).length) body.requestOptions = requestOptions;

    const r = await readOnlyGuard(`${this.baseUrl}/rest/api/v1/search`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      intent: 'glean:search',
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Glean search failed: ${r.status} ${text}`);
    }
    return (await r.json()) as GleanSearchResponse;
  }

  /**
   * Auto-paginate a search across cursors until exhausted. Returns the
   * combined document list. Hard-caps at maxPages * pageSize for safety.
   */
  async searchAll(
    opts: GleanSearchOptions,
    maxPages = 20,
  ): Promise<GleanDocument[]> {
    const out: GleanDocument[] = [];
    let cursor: string | undefined = opts.cursor;
    for (let page = 0; page < maxPages; page++) {
      const resp = await this.search({ ...opts, cursor });
      const docs = resp.documents ?? resp.results ?? [];
      out.push(...docs);
      if (!resp.cursor || !resp.hasMoreResults) break;
      cursor = resp.cursor;
    }
    return out;
  }

  /**
   * Fetch full document content for an array of URLs via
   * POST /rest/api/v1/getdocument. Per-refresh cached.
   */
  async getDocuments(urls: string[]): Promise<GleanDocument[]> {
    const need = urls.filter((u) => !this.docCache.has(u));
    if (need.length === 0) {
      return urls
        .map((u) => this.docCache.get(u))
        .filter((d): d is GleanDocument => d !== undefined);
    }

    const r = await readOnlyGuard(`${this.baseUrl}/rest/api/v1/getdocument`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ urls: need }),
      intent: 'glean:getdocument',
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Glean getdocument failed: ${r.status} ${text}`);
    }
    const parsed = (await r.json()) as GleanReadDocumentResponse;
    for (const doc of parsed.documents ?? []) {
      if (doc.url) this.docCache.set(doc.url, doc);
    }

    return urls
      .map((u) => this.docCache.get(u))
      .filter((d): d is GleanDocument => d !== undefined);
  }

  /**
   * POST /rest/api/v1/chat — Glean Assistant. Returns an assembled
   * assistant reply plus deduped citation metadata. We intentionally do
   * not stream today: Next.js route handlers for in-app use buffer the
   * full reply and return JSON (simpler client; assistant replies are
   * small enough to not need SSE for the MVP).
   */
  async chat(opts: GleanChatOptions): Promise<GleanChatMessage> {
    const body: Record<string, unknown> = {
      messages: opts.messages,
      stream: opts.stream ?? false,
    };
    if (opts.chatId) body.chatId = opts.chatId;

    const r = await readOnlyGuard(`${this.baseUrl}/rest/api/v1/chat`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      intent: 'glean:chat',
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Glean chat failed: ${r.status} ${text}`);
    }
    const parsed = (await r.json()) as GleanChatResponse;

    // Find the last GLEAN_AI message (Glean echoes the full conversation).
    const all = parsed.messages ?? [];
    const reply = [...all].reverse().find((m) => m.author === 'GLEAN_AI') ?? all[all.length - 1];
    if (!reply) return { author: 'GLEAN_AI', text: '', citations: [] };

    const text = (reply.fragments ?? [])
      .map((f) => f.text ?? '')
      .join('')
      .trim();

    // Citations can show up either inline on fragments or aggregated on
    // the message. Collect both, then dedupe by URL.
    const seen = new Map<string, GleanChatCitation>();
    const pushDoc = (
      doc: GleanDocument | undefined,
      snippet: string | undefined,
    ): void => {
      if (!doc?.url) return;
      if (seen.has(doc.url)) return;
      seen.set(doc.url, {
        url: doc.url,
        title: doc.title,
        datasource: doc.datasource,
        citationId: doc.citationId,
        snippet,
      });
    };
    for (const frag of reply.fragments ?? []) {
      pushDoc(frag.citation?.sourceDocument, undefined);
      pushDoc(frag.citation?.sourceFile, undefined);
    }
    for (const cite of reply.citations ?? []) {
      pushDoc(cite.sourceDocument, cite.snippet?.text);
      pushDoc(cite.sourceFile, cite.snippet?.text);
    }

    return {
      author: reply.author ?? 'GLEAN_AI',
      text,
      citations: Array.from(seen.values()),
    };
  }

  async healthCheck(): Promise<{ ok: boolean; details: string }> {
    try {
      const r = await this.search({ query: 'healthcheck', pageSize: 1 });
      const count = (r.documents ?? r.results ?? []).length;
      return { ok: true, details: `Glean reachable; sample query returned ${count} doc(s)` };
    } catch (err) {
      return { ok: false, details: (err as Error).message };
    }
  }
}

export function readGleanCredsFromEnv(): GleanCredentials | null {
  const e = process.env;
  if (!e.GLEAN_MCP_TOKEN || !e.GLEAN_MCP_BASE_URL) return null;
  return { token: e.GLEAN_MCP_TOKEN, baseUrl: e.GLEAN_MCP_BASE_URL };
}
