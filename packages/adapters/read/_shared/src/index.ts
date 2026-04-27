// readOnlyGuard: every outbound HTTP call must pass through here.
// Rejects anything that is not GET, or POST to an allowlisted query/search endpoint.

const ALLOWED_POST_PATHS: { host: string; pathRegex: RegExp }[] = [
  // Salesforce REST query/search endpoints
  { host: '*.salesforce.com', pathRegex: /\/services\/data\/v\d+\.\d+\/(query|queryAll|search|composite\/sobjects\/?$|tooling\/query)/ },
  // Glean API search/chat/read
  { host: 'api.glean.com', pathRegex: /\/(rest\/api\/v1\/(search|chat|getdocument|documents))/ },
  { host: '*.glean.com', pathRegex: /\/(rest\/api\/v1\/(search|chat|getdocument|documents))/ },
  // Zuora data query (read-only)
  { host: '*.zuora.com', pathRegex: /\/(query|api\/data-query)/ },
  // Zuora Remote MCP (POST is the JSON-RPC transport; tool gating happens upstream by allowlist)
  { host: '*.zuora.com', pathRegex: /\/mcp(\/|$)/ },
];

function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith('*.')) {
    const tail = pattern.slice(1); // ".salesforce.com"
    return host.endsWith(tail);
  }
  return pattern === host;
}

export class ReadOnlyViolation extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ReadOnlyViolation';
  }
}

export interface GuardedRequestInit extends RequestInit {
  // Marker tag so call sites can declare intent for audit.
  intent?: string;
}

export async function readOnlyGuard(
  url: string,
  init: GuardedRequestInit = {},
): Promise<Response> {
  const u = new URL(url);
  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return fetch(url, init);
  }
  if (method === 'POST') {
    const ok = ALLOWED_POST_PATHS.some(
      (a) => hostMatches(a.host, u.hostname) && a.pathRegex.test(u.pathname),
    );
    if (!ok) {
      throw new ReadOnlyViolation(
        `readOnlyGuard rejected POST ${u.hostname}${u.pathname}`,
      );
    }
    return fetch(url, init);
  }
  throw new ReadOnlyViolation(
    `readOnlyGuard rejected ${method} ${u.hostname}${u.pathname}`,
  );
}

// Helper used inside adapters: rate-limited fetch (very small, in-memory).
export class RateLimiter {
  private timestamps: number[] = [];
  constructor(private maxPerWindow: number, private windowMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxPerWindow) {
      const earliest = this.timestamps[0]!;
      await new Promise((r) => setTimeout(r, this.windowMs - (now - earliest) + 5));
    }
    this.timestamps.push(Date.now());
  }
}
