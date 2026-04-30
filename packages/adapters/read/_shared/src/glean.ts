// GleanClient — shared client for Glean. Speaks Glean's MCP
// (Streamable HTTP) transport, which is what non-admin tokens are
// scoped to in most tenants. The public API mirrors the original REST
// client (search / searchAll / getDocuments / chat / healthCheck) so
// route handlers and worker adapters don't need to change.
//
// Read-only by construction:
//   - Only invokes the `search`, `chat`, and `read_document` MCP tools.
//     readOnlyGuard still gates the underlying POST so any future write
//     verb hits a hard stop in tests + at runtime.
//
// Auth: Bearer token via GLEAN_MCP_TOKEN. Token is treated as opaque —
// if Glean rejects it (401 / Invalid Secret) the error propagates to
// the caller for surfacing.
//
// Per-refresh caching: each GleanClient instance is constructed inside
// the worker's runRefresh() loop (PR-1 RefreshContext), so its in-memory
// caches are scoped to a single refresh and discarded after. The MCP
// session id is also instance-scoped — a fresh client = a fresh
// initialize handshake.
import { readOnlyGuard } from './index.js';

// ---------------------------------------------------------------------------
// Process-wide rate limiter for Glean's MCP transport.
//
// Glean enforces a tight per-minute rate limit on the search tool that
// short-window retries cannot satisfy: a burst of 8 parallel calls
// finishes ~4 of them and leaves the rest in 429 even after 5s of
// exponential backoff. Empirically the limit behaves like a sliding
// window measured in seconds, not requests-per-second, so the only
// reliable mitigation is to GATE concurrency at the GleanClient layer
// regardless of how many adapters are running in parallel.
//
// Tunables (env vars, all optional):
//   - GLEAN_MAX_INFLIGHT       max parallel calls in flight (default 2)
//   - GLEAN_MIN_INTERVAL_MS    min gap between call starts  (default 300)
//   - GLEAN_MAX_RETRY_ATTEMPTS retries on 429              (default 6)
//   - GLEAN_RETRY_BASE_MS      first backoff delay         (default 1500)
// ---------------------------------------------------------------------------

const GLEAN_MAX_INFLIGHT = Number(process.env.GLEAN_MAX_INFLIGHT) || 2;
const GLEAN_MIN_INTERVAL_MS = Number(process.env.GLEAN_MIN_INTERVAL_MS) || 300;
const GLEAN_MAX_RETRY_ATTEMPTS = Number(process.env.GLEAN_MAX_RETRY_ATTEMPTS) || 6;
const GLEAN_RETRY_BASE_MS = Number(process.env.GLEAN_RETRY_BASE_MS) || 1500;

let inFlight = 0;
let lastStartedAt = 0;
const waitQueue: Array<() => void> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  // 1.5s, 3s, 6s, 12s, 24s, 48s … plus 0–500ms jitter so retries
  // belonging to the same burst don't all fire on the same tick.
  const base = GLEAN_RETRY_BASE_MS * Math.pow(2, attempt);
  return Math.min(60_000, base) + Math.floor(Math.random() * 500);
}

function isRateLimitMessage(msg: string): boolean {
  const s = msg.toLowerCase();
  return (
    s.includes('rate limit') ||
    s.includes('429') ||
    s.includes('too many requests')
  );
}

/** Acquire a Glean call slot. Honors both the in-flight cap and the
 *  minimum inter-request gap so that bursts get serialized. */
async function acquireGleanSlot(): Promise<void> {
  if (inFlight >= GLEAN_MAX_INFLIGHT) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  inFlight++;
  const sinceLast = Date.now() - lastStartedAt;
  if (sinceLast < GLEAN_MIN_INTERVAL_MS) {
    await sleep(GLEAN_MIN_INTERVAL_MS - sinceLast);
  }
  lastStartedAt = Date.now();
}

function releaseGleanSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waitQueue.shift();
  if (next) next();
}

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

  /** MCP endpoint URL — used as-is for JSON-RPC POSTs. */
  private readonly mcpUrl: string;
  /** Captured from Mcp-Session-Id response header on initialize. */
  private mcpSessionId?: string;
  /** Memoized initialize handshake; one per client lifetime. */
  private mcpInit?: Promise<void>;
  /** Monotonic JSON-RPC id counter. */
  private rpcId = 0;

  constructor(creds: GleanCredentials) {
    // Operators normally set GLEAN_MCP_BASE_URL to Glean's MCP transport
    // endpoint (e.g. `https://zuora-be.glean.com/mcp/default`). That's
    // what we use directly. If a tenant-root URL was provided instead,
    // append the conventional `/mcp/default` so non-admin tokens still
    // resolve to a usable endpoint.
    let url = creds.baseUrl.replace(/\/$/, '');
    if (!/\/mcp(\/[^/]+)?$/.test(url)) {
      url = `${url}/mcp/default`;
    }
    this.mcpUrl = url;
    // Stored separately from headers because we also need the bare token
    // for the readOnlyGuard call paths (no other reason).
    this.baseUrl = url;
    this.headers = {
      'content-type': 'application/json',
      // Glean's MCP server replies with either application/json OR
      // text/event-stream depending on the server build; advertise both.
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${creds.token}`,
    };
  }

  // -------------------------------------------------------------------
  // MCP transport (Streamable HTTP, JSON-RPC 2.0)
  //
  // Per the MCP spec, a session is established by:
  //   1. POST { method: 'initialize', ... }
  //      → server returns capabilities + an Mcp-Session-Id header.
  //   2. POST { method: 'notifications/initialized' }  (no id, no reply)
  // Subsequent requests echo the session id header back.
  //
  // Glean's MCP server may answer with SSE for streaming tools; we
  // collapse the stream into the final JSON-RPC envelope and parse
  // that.
  // -------------------------------------------------------------------
  private async ensureMcpInitialized(): Promise<void> {
    if (!this.mcpInit) {
      this.mcpInit = this.doMcpInitialize().catch((err) => {
        // Reset so a later call can retry; otherwise a transient init
        // failure permanently bricks the client.
        this.mcpInit = undefined;
        throw err;
      });
    }
    await this.mcpInit;
  }

  private async doMcpInitialize(): Promise<void> {
    const initResp = await this.mcpRawPost(
      {
        jsonrpc: '2.0',
        id: ++this.rpcId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mdas-web', version: '0.1.0' },
        },
      },
      'glean:mcp-initialize',
    );
    const sid = initResp.headers.get('mcp-session-id');
    if (sid) this.mcpSessionId = sid;
    // Drain body so the connection can be released.
    await initResp.text();
    // Send the initialized notification (no id → no response).
    const notifResp = await this.mcpRawPost(
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
      'glean:mcp-notify',
    );
    await notifResp.text();
  }

  private async mcpRawPost(
    payload: Record<string, unknown>,
    intent: string,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...this.headers };
    if (this.mcpSessionId) headers['mcp-session-id'] = this.mcpSessionId;
    const r = await readOnlyGuard(this.mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      intent,
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(
        `Glean MCP ${String(payload.method)} failed: ${r.status} ${text}`,
      );
    }
    return r;
  }

  /** Read a JSON-RPC response that may have come back as plain JSON
   *  or as an SSE stream of `data:`-prefixed chunks. Returns the parsed
   *  envelope (with `result` or `error`). */
  private async readRpcEnvelope(r: Response): Promise<{
    result?: McpToolResult;
    error?: { code: number; message: string; data?: unknown };
  }> {
    const ct = r.headers.get('content-type') ?? '';
    const text = await r.text();
    if (ct.includes('text/event-stream') || text.startsWith('event:') || text.startsWith('data:')) {
      // Parse SSE: find the last `data: <json>` line that is a JSON-RPC
      // response (has `id` and either `result` or `error`).
      let last:
        | { result?: McpToolResult; error?: { code: number; message: string } }
        | undefined;
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if ('result' in parsed || 'error' in parsed) {
            last = parsed as typeof last;
          }
        } catch {
          /* not JSON, skip */
        }
      }
      if (!last) {
        throw new Error(
          `Glean MCP returned SSE with no parseable JSON-RPC envelope: ${text.slice(0, 200)}`,
        );
      }
      return last;
    }
    try {
      return JSON.parse(text) as {
        result?: McpToolResult;
        error?: { code: number; message: string };
      };
    } catch {
      throw new Error(`Glean MCP returned non-JSON: ${text.slice(0, 200)}`);
    }
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    // Process-wide rate limiter: serialize Glean calls so that even
    // when 3 adapters all loop over 300 accounts in parallel, we never
    // open more than GLEAN_MAX_INFLIGHT requests against Glean's MCP
    // search at once. Combined with retry-on-429 below, this keeps
    // the refresh under Glean's per-minute throttle.
    await acquireGleanSlot();
    try {
    // Glean's "Elastic rate limit exceeded" surfaces as a tools/call
    // result with isError + a 429-shaped error message rather than as
    // an HTTP 429. Retry with longer backoff for the per-minute window.
    const maxAttempts = GLEAN_MAX_RETRY_ATTEMPTS;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.ensureMcpInitialized();
      try {
        const resp = await this.mcpRawPost(
          {
            jsonrpc: '2.0',
            id: ++this.rpcId,
            method: 'tools/call',
            params: { name, arguments: args },
          },
          `glean:mcp-tool:${name}`,
        );
        const env = await this.readRpcEnvelope(resp);
        if (env.error) {
          throw new Error(
            `Glean MCP tools/call(${name}) error: ${env.error.message} (${env.error.code})`,
          );
        }
        const result = env.result ?? { content: [] };
        if (result.isError) {
          const txt = (result.content ?? [])
            .map((c) => (c.type === 'text' ? c.text : ''))
            .join('\n')
            .trim();
          // Detect rate-limit signal embedded in tool error text.
          if (isRateLimitMessage(txt) && attempt < maxAttempts - 1) {
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new Error(`Glean MCP tool '${name}' returned error: ${txt}`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        const msg = (err as Error).message ?? '';
        // HTTP-level 429 (rare; usually surfaces as isError above).
        if ((msg.includes('429') || isRateLimitMessage(msg)) && attempt < maxAttempts - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Glean MCP retries exhausted');
    } finally {
      releaseGleanSlot();
    }
  }

  // -------------------------------------------------------------------
  // Public API — same shapes as the original REST client.
  // -------------------------------------------------------------------

  /** Run Glean's `search` MCP tool.
   *
   * The MCP server's `search` tool currently accepts only the `query`
   * argument (other Glean SDK params like `pageSize` / `cursor` /
   * `datasources` are ignored or rejected). We forward `datasources`
   * defensively because some Glean tenant builds expose it, but the
   * server tolerates unknown arguments only when its tool schema marks
   * them optional. To avoid `unknown field` errors we keep the arg set
   * minimal. */
  async search(opts: GleanSearchOptions): Promise<GleanSearchResponse> {
    const args: Record<string, unknown> = { query: opts.query };
    const result = await this.callTool('search', args);
    return parseSearchResult(result);
  }

  /** Auto-paginate a search across cursors. Glean's MCP `search` tool
   *  may not echo cursors back; in that case we return the first page. */
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

  /** Fetch document text via the `read_document` MCP tool.
   *
   * Glean's tool schema: `{ urls: string[] }` (batch only — single-url
   * variant doesn't exist) plus optional `mode: "raw_bytes"`. We always
   * use the default mode so we get extracted text. */
  async getDocuments(urls: string[]): Promise<GleanDocument[]> {
    const need = urls.filter((u) => !this.docCache.has(u));
    if (need.length === 0) {
      return urls
        .map((u) => this.docCache.get(u))
        .filter((d): d is GleanDocument => d !== undefined);
    }
    try {
      const result = await this.callTool('read_document', { urls: need });
      const docs = parseReadDocumentBatch(result, need);
      for (const doc of docs) {
        if (doc.url) this.docCache.set(doc.url, doc);
      }
    } catch {
      // Non-fatal: getDocuments callers treat missing entries as cache
      // misses (worker enrichment is best-effort).
    }
    return urls
      .map((u) => this.docCache.get(u))
      .filter((d): d is GleanDocument => d !== undefined);
  }

  /** Run Glean's `chat` MCP tool.
   *
   * Glean's tool schema: `{ message: string, context?: string[] }`
   * — the assistant takes the latest user message plus an optional
   * array of prior messages-as-strings for context. We map our richer
   * GleanChatRequestMessage[] into that flatter shape. */
  async chat(opts: GleanChatOptions): Promise<GleanChatMessage> {
    const flat = opts.messages.map((m) => ({
      author: m.author ?? 'USER',
      text: (m.fragments ?? []).map((f) => f.text).join('').trim(),
    }));
    const lastUser = [...flat].reverse().find((m) => m.author === 'USER');
    const messageText = lastUser?.text ?? '';
    const context = flat.slice(0, lastUser ? flat.lastIndexOf(lastUser) : flat.length)
      .map((m) => `${m.author === 'GLEAN_AI' ? 'Assistant' : 'User'}: ${m.text}`);
    const args: Record<string, unknown> = { message: messageText };
    if (context.length > 0) args.context = context;
    const result = await this.callTool('chat', args);
    return parseChatResult(result);
  }

  async healthCheck(): Promise<{ ok: boolean; details: string }> {
    try {
      const r = await this.search({ query: 'healthcheck', pageSize: 1 });
      const count = (r.documents ?? r.results ?? []).length;
      return {
        ok: true,
        details: `Glean MCP reachable (${this.mcpUrl}); sample query returned ${count} result(s)`,
      };
    } catch (err) {
      return { ok: false, details: (err as Error).message };
    }
  }
}

// ---------------------------------------------------------------------------
// MCP result shapes + parsers
// ---------------------------------------------------------------------------

interface McpToolContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  /** Other types (image, resource) carry alternative fields we ignore. */
  [k: string]: unknown;
}

interface McpToolResult {
  content?: McpToolContent[];
  /** Some MCP servers attach a structured payload alongside text. */
  structuredContent?: unknown;
  isError?: boolean;
}

function toolText(result: McpToolResult): string {
  return (result.content ?? [])
    .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
    .join('\n')
    .trim();
}

/** Extract markdown-style links `[title](url)` and a trailing snippet. */
function extractDocsFromMarkdown(text: string): GleanDocument[] {
  const docs: GleanDocument[] = [];
  const lines = text.split(/\r?\n/);
  let pending: GleanDocument | null = null;
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (pending) {
        docs.push(pending);
        pending = null;
      }
      continue;
    }
    const m = linkRe.exec(line);
    if (m) {
      if (pending) docs.push(pending);
      pending = {
        title: m[1],
        url: m[2],
        snippets: [],
      };
      // Anything after the link is treated as a snippet seed.
      const tail = line.slice((m.index ?? 0) + m[0].length).replace(/^[\s\-—–:]+/, '').trim();
      if (tail) pending.snippets = [tail];
      continue;
    }
    if (pending) {
      const arr = pending.snippets ?? [];
      arr.push(line);
      pending.snippets = arr;
    }
  }
  if (pending) docs.push(pending);
  // Collapse multi-line snippets into one string each.
  for (const d of docs) {
    if (d.snippets && d.snippets.length > 1) {
      d.snippets = [d.snippets.join(' ').slice(0, 600)];
    } else if (d.snippets && d.snippets[0]) {
      d.snippets = [d.snippets[0].slice(0, 600)];
    }
  }
  return docs;
}

function parseSearchResult(result: McpToolResult): GleanSearchResponse {
  // Best case: server attached structuredContent with {results:[...]}.
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const sc = result.structuredContent as GleanSearchResponse;
    if (Array.isArray(sc.results) || Array.isArray(sc.documents)) return sc;
  }
  const text = toolText(result);
  if (!text) return { results: [] };
  // Try strict JSON first (some Glean MCP builds return JSON in the text block).
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.results)) return { results: obj.results as GleanDocument[] };
      if (Array.isArray(obj.documents)) return { documents: obj.documents as GleanDocument[] };
      if (Array.isArray(parsed)) return { results: parsed as GleanDocument[] };
    }
  } catch {
    /* fall through */
  }
  // Glean's MCP `search` tool returns a YAML-ish string. Parse it.
  const yamlDocs = parseGleanYamlDocuments(text);
  if (yamlDocs.length > 0) return { results: yamlDocs };
  // Last-resort: markdown links.
  return { results: extractDocsFromMarkdown(text) };
}

/**
 * Parse Glean's YAML-like search response. Sample shape:
 *
 *   documents[26]:
 *     - createTime: "2026-03-19T18:42:03Z"
 *       datasource: workflows
 *       title: "..."
 *       url: "https://..."
 *       snippets[3]: "foo","bar","baz"
 *       matchingFilters:
 *         app[1]: docs
 *     - ...
 *   entities[1]:
 *     - ...
 *
 * We only extract documents (not entities) and only the fields the UI
 * cares about: title, url, datasource, snippets[0], updateTime/createTime.
 */
function parseGleanYamlDocuments(text: string): GleanDocument[] {
  const lines = text.split(/\r?\n/);
  const out: GleanDocument[] = [];
  let inDocs = false;
  let cur: GleanDocument | null = null;
  let docIndent = -1; // indent of the doc's top-level key/value lines
  // Track the currently-open nested map (e.g. `matchingFilters:`). When
  // set, lines deeper than docIndent route into this map. Cleared when
  // we return to docIndent (or shallower).
  let nestedKey: string | null = null;
  let nestedIndent = -1;
  let nested: Record<string, string[]> | null = null;

  const stripQuotes = (v: string): string => {
    const s = v.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  };

  /** Split a comma-separated list of YAML-ish quoted/unquoted scalars,
   *  respecting double-quote escapes. Glean uses `\"` inside quotes. */
  const splitScalars = (s: string): string[] => {
    const items: string[] = [];
    let buf = '';
    let inQuote = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (esc) { buf += ch; esc = false; continue; }
      if (ch === '\\' && inQuote) { esc = true; continue; }
      if (ch === '"') { inQuote = !inQuote; buf += ch; continue; }
      if (ch === ',' && !inQuote) {
        items.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) items.push(buf.trim());
    return items.map(stripQuotes);
  };

  /** Close the current nested-map context if any. */
  const closeNested = (): void => {
    if (nestedKey && nested && cur) {
      // Attach to the document under the conventional name.
      if (nestedKey === 'matchingFilters') {
        cur.matchingFilters = { ...(cur.matchingFilters ?? {}), ...nested };
      }
      // Other nested maps (owner, customer, …) ignored for now — cerebro/
      // gainsight only need matchingFilters.
    }
    nestedKey = null;
    nested = null;
    nestedIndent = -1;
  };

  /** Close the current document if any. */
  const closeDoc = (): void => {
    closeNested();
    if (cur) {
      out.push(cur);
      cur = null;
      docIndent = -1;
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trimStart();
    const indent = raw.length - trimmed.length;
    if (!trimmed) continue;

    // Top-level section header: `documents[N]:` / `entities[N]:` / etc.
    if (indent === 0 && /^[a-zA-Z_][\w]*(?:\[\d+\])?\s*:\s*$/.test(trimmed)) {
      closeDoc();
      inDocs = /^documents/.test(trimmed);
      continue;
    }
    if (!inDocs) continue;

    // New document marker: `- key: value` (the dash starts a new entry)
    const dashMatch = /^-\s+(.*)$/.exec(trimmed);
    if (dashMatch) {
      closeDoc();
      cur = {};
      docIndent = indent + 2; // children align two past the dash
      const rest = dashMatch[1]!.trim();
      if (rest) applyKv(cur, rest, indent + 2);
      continue;
    }

    if (!cur) continue;

    // If we've returned to or above the doc's own indent, the doc block
    // has ended (next sibling doc or new section).
    if (indent < docIndent) {
      closeDoc();
      continue;
    }

    // At doc indent: regular doc field OR start of a nested map.
    if (indent === docIndent) {
      closeNested();
      applyKv(cur, trimmed, indent);
      continue;
    }

    // Deeper than doc indent: must belong to an open nested-map block.
    // (Glean indents nested map children 2 spaces past the parent key.)
    const target: Record<string, string[]> | null = nested;
    if (target && indent > nestedIndent) {
      const colon = trimmed.indexOf(':');
      if (colon > 0) {
        const k = trimmed.slice(0, colon).trim().replace(/\[\d+\]$/, '');
        const v = trimmed.slice(colon + 1).trim();
        if (v) (target as Record<string, string[]>)[k] = splitScalars(v);
      }
      continue;
    }
    // Otherwise: a nested key was opened but we're back at its level →
    // close it and re-process the line as a doc field.
    closeNested();
    if (indent === docIndent) applyKv(cur, trimmed, indent);
  }
  closeDoc();

  function applyKv(doc: GleanDocument, kv: string, lineIndent: number): void {
    const colon = kv.indexOf(':');
    if (colon < 0) return;
    const rawKey = kv.slice(0, colon).trim();
    const rawVal = kv.slice(colon + 1).trim();
    // Strip array-length annotations like `snippets[16]` → `snippets`.
    const key = rawKey.replace(/\[\d+\]$/, '');
    // Empty value with key = nested-map header. Open a nested-map block.
    if (!rawVal) {
      if (key === 'matchingFilters') {
        nestedKey = key;
        nested = doc.matchingFilters ? { ...doc.matchingFilters } : {};
        nestedIndent = lineIndent;
      } else {
        // Open + ignored (we only care about matchingFilters today).
        nestedKey = key;
        nested = {};
        nestedIndent = lineIndent;
      }
      return;
    }
    const val = stripQuotes(rawVal);
    switch (key) {
      case 'title':
        doc.title = val;
        break;
      case 'url':
        doc.url = val;
        break;
      case 'datasource':
        doc.datasource = val;
        break;
      case 'createTime':
        doc.createTime = val;
        break;
      case 'updateTime':
        doc.updateTime = val;
        break;
      case 'snippets':
        doc.snippets = splitScalars(rawVal).filter((s) => s.length > 0);
        break;
      case 'percentRetrieved':
        doc.percentRetrieved = val;
        break;
      default:
        break;
    }
  }

  // Filter out docs with no URL — they're useless to the UI.
  return out.filter((d) => d.url);
}

function parseReadDocumentBatch(
  result: McpToolResult,
  urls: string[],
): GleanDocument[] {
  const text = toolText(result);
  if (!text) return [];
  // If the server returned JSON, prefer that.
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return (parsed as GleanDocument[]).map((d, i) => ({
        url: d.url ?? urls[i] ?? '',
        title: d.title,
        datasource: d.datasource,
        snippets: d.snippets,
        richDocumentData: d.richDocumentData,
        updateTime: d.updateTime,
      }));
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { documents?: unknown }).documents)) {
      return (parsed as { documents: GleanDocument[] }).documents;
    }
  } catch {
    /* fall through to YAML parse */
  }
  const docs = parseGleanYamlDocuments(text);
  if (docs.length > 0) return docs;
  // No structure recognized — stuff the whole text into the first URL.
  return urls.map((url, i) =>
    i === 0
      ? { url, richDocumentData: { content: text, mimeType: 'text/plain' } }
      : { url },
  );
}

function parseChatResult(result: McpToolResult): GleanChatMessage {
  // structuredContent shape, when present, is preferred.
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const sc = result.structuredContent as {
      reply?: string;
      text?: string;
      citations?: GleanChatCitation[];
    };
    return {
      author: 'GLEAN_AI',
      text: (sc.reply ?? sc.text ?? '').trim(),
      citations: sc.citations ?? [],
    };
  }
  const raw = toolText(result);
  if (!raw) return { author: 'GLEAN_AI', text: '', citations: [] };
  // If the entire payload is JSON, parse it.
  try {
    const parsed = JSON.parse(raw) as Partial<{
      reply: string;
      text: string;
      response: string;
      citations: GleanChatCitation[];
    }>;
    const replyText = parsed.reply ?? parsed.text ?? parsed.response;
    if (typeof replyText === 'string') {
      return {
        author: 'GLEAN_AI',
        text: replyText.trim(),
        citations: parsed.citations ?? [],
      };
    }
  } catch {
    /* fall through — treat as plain text */
  }
  // Heuristic: extract any markdown-style citation links from the body so
  // the UI's citations rail shows something useful.
  const citations: GleanChatCitation[] = [];
  const seen = new Set<string>();
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(raw)) !== null) {
    if (seen.has(m[2]!)) continue;
    seen.add(m[2]!);
    citations.push({ title: m[1], url: m[2] });
  }
  return {
    author: 'GLEAN_AI',
    text: raw,
    citations,
  };
}

export function readGleanCredsFromEnv(): GleanCredentials | null {
  const e = process.env;
  if (!e.GLEAN_MCP_TOKEN || !e.GLEAN_MCP_BASE_URL) return null;
  return { token: e.GLEAN_MCP_TOKEN, baseUrl: e.GLEAN_MCP_BASE_URL };
}
