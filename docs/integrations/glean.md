# Glean Integration

Glean has two distinct roles in MDAS:

1. **Worker-side enrichment** (offline): adapters that pull Glean data into the snapshot DB during a refresh. Documented in the Adapter table below.
2. **In-app live access** (web app): the `/glean` page, the cmd-K command bar, and the per-account "Search Glean" button. Implemented in `apps/web/src/app/api/glean/*` + `apps/web/src/components/Glean*`.

Both share the same `GleanClient` at `packages/adapters/read/_shared/src/glean.ts` and route every HTTP call through `readOnlyGuard`. Auth posture for the in-app side is controlled by `AUTH_MODE` — see "In-app usage" below.

## Adapter map

| Adapter | Datasources used | Populates |
|---|---|---|
| `cerebro-glean` (PR-4) | `cerebro` (`type:healthrisk`) | `cerebroRisks`, `cerebroSubMetrics` |
| `glean-mcp` (PR-5, this doc) | `gdrive`, `googlecalendar`, `slack`, `gmail` | `accountPlanLinks`, `recentMeetings` |
| `gainsight` (PR-7) | `gainsight` (`type:calltoaction`) | `gainsightTasks` |

All Glean-backed adapters share the `GleanClient` at `packages/adapters/read/_shared/src/glean.ts` for auth, pagination, in-memory per-refresh document caching, and read-only invariant enforcement.

## Auth

```bash
GLEAN_MCP_TOKEN=<bearer token>
GLEAN_MCP_BASE_URL=https://api.glean.com   # or your tenant-specific REST host
```

`readGleanCredsFromEnv()` returns `null` when either is missing, allowing the adapter to no-op cleanly in dev.

## glean-mcp adapter — what it does

Per refresh:

1. **Discover the account set** by reading the prior successful snapshot via `@mdas/db.latestSuccessfulRun()` + `readSnapshotAccounts()`. This adapter does **not** discover new accounts — Salesforce / `localSnapshots` own that responsibility. If no prior snapshot exists, it skips.
2. **For each prior-known account**, run two parallel sub-fetches with bounded concurrency (`GLEAN_CONCURRENCY`, default 5):
   - `fetchAccountContext()` — gdrive search for plans / decks / QBR docs (`account-context.ts`)
   - `fetchAccountEvidence()` — calendar + slack + gmail signals (`evidence.ts`)
3. **Emit `Partial<CanonicalAccount>`** for accounts where at least one sub-fetch returned data. The worker's `mergeAdapterResults` spreads this onto the prior-snapshot record so non-Glean fields (CSE Sentiment from SF, Cerebro booleans from cerebro-glean, etc.) are preserved.

## Account context (`account-context.ts`)

Search query template:

```
"<accountName>" (account plan OR QBR OR business review OR success plan)
```

Scoped to `gdrive`. The result set is post-filtered with a small keyword allowlist (`account plan`, `qbr`, `business review`, `success plan`, `plan`, `review`) to drop invoices, contracts, and other gdrive noise that mention the account by name. Top N (default 5) become `accountPlanLinks` entries with `{ title, url, lastModified }`. Each also produces a `SourceLink { source: 'glean', citationId, snippetIndex }` per the citation discipline (Section 2.4).

## Evidence (`evidence.ts`)

Three parallel datasource searches per account, top N=3 each, recency window = 30 days:

| Datasource | Query template | Bucket | Body fetched? |
|---|---|---|---|
| `googlecalendar` | `"<acct>" (renewal OR EBR OR QBR OR review OR sync OR escalation)` | `calendar` | yes (snippet only) |
| `slack` | `"<acct>" (renewal OR risk OR escalation OR churn OR EBR OR QBR)` | `calendar` (no slack discriminator in canonical type today) | metadata only |
| `gmail` | `from:support@staircase.ai "<acct>"` | `staircase` | **metadata only — never `getDocument()`** |

### Privacy guard for Gmail

> Per Section 2.3 of the refactor prompt: do not retrieve Gmail message bodies for accounts the current user doesn't own.

The current MDAS worker has no per-user identity — it pulls all Expand 3 accounts under a single bearer token. The strictest interpretation of the rule is therefore applied:

- Gmail searches are scoped to a known sender (`support@staircase.ai`), so we only see Staircase summary emails — these are by design system-generated digests, not customer-confidential prose.
- The adapter **never** calls `getDocument()` on Gmail URLs. All Gmail-derived `MeetingSummary` records use only the `title` and the first ≤240 chars of `snippets[0]` returned by Glean's search response (which Glean has access-checked at index time).
- Rule enforced in code at `evidence.ts:SOURCES[gmail].fullDoc = false` and the `buildSummary(doc, fullDoc)` branch.

When MDAS gains per-user identity (planned PR-7+), this filter will be relaxed for the requesting user's owned accounts.

## Concurrency + rate limiting

```
GLEAN_CONCURRENCY=5   # default; tune per tenant rate limits
```

The pool is implemented in `glean-mcp/src/index.ts::mapWithConcurrency()`. The `GleanClient`'s in-memory `docCache` deduplicates `getDocuments()` calls within one refresh — a doc fetched by `cerebro-glean` is free for `glean-mcp` to read again.

## Read-only invariant

`GleanClient` exposes only `search` / `searchAll` / `getDocuments` / `healthCheck`. All HTTP requests route through `readOnlyGuard`, which only permits Glean's `search`, `chat`, `getdocument`, and `documents` REST paths. CI guard `scripts/ci-guard.mjs` greps adapter source for write verbs (`glean_create_*`, `glean_update_*`, `glean_delete_*`, `glean_send_*`, `glean_post_*`, `glean_upsert_*`) — none exist.

## Gainsight adapter (PR-7)

Separate adapter at `packages/adapters/read/gainsight/`. Reads `app:gainsight` filtered to `type:calltoaction` (CTAs / Risk tasks). Single-sweep query (no per-account loop) — Glean's CTA corpus is small enough (~1k docs across the tenant).

**Glean facets used** (from `matchingFilters`):

| Glean facet | Mapped to |
|---|---|
| `gscompanyname` | account-name join key (after `normalizeName()`) |
| `gscompanygsid` | not used (Gainsight internal ID, no SFDC mapping in Glean) |
| `gsctaname` | `GainsightTask.title` |
| `gsctaownername` | `GainsightTask.owner` |
| `gsctapriority` | preserved in snippet, surfaced on the drill-in |
| `gsctastatus` | `GainsightTask.status` (also drives `isOpen` for sort) |
| `gsctatype` | preserved in snippet (Risk / Expansion / Onboarding / Lifecycle) |

**Snippet fields** (parsed from `Label: value` lines in `doc.snippets`):

- `Due Date: <ISO>` → `GainsightTask.dueDate`
- `Created Date: <ISO>` → freshness stamp on `lastFetchedFromSource['gainsight']`
- `Total Task Count` / `Closed Task Count` / `Percent Complete` — preserved as snippets

### Cross-system join — name matching

Glean's Gainsight connector exposes the Gainsight company GSID but **not** the SFDC Account ID. The adapter therefore joins via case-insensitive name match against the prior snapshot's `accountName`, with light normalization in `mapper.ts:normalizeName()`:

- lowercase
- strip trailing `, Inc.` / `, LLC` / `, Ltd.` / ` GmbH` / ` SA` / ` Corp.`
- strip `.` and `,`
- collapse repeated whitespace

Unmatched CTAs are dropped and counted in the `gainsight.mapped { accountsUnmatched }` log line. If a future schema change adds `gssalesforceaccountid` to Glean's Gainsight facets, this code should be updated to prefer the structured key.

### Sorting + cap

Per matched account, CTAs are sorted (open first, then by due date ascending, nulls last) and capped at 25 entries to keep the canonical record bounded. The first CTA in this list is what the Account Drill-In's "Next Action" pill displays.

### Activation

```bash
echo "ADAPTER_GAINSIGHT=real" >> .env
echo "GLEAN_MCP_TOKEN=..." >> .env                # same token as the other Glean adapters
echo "GLEAN_MCP_BASE_URL=https://api.glean.com" >> .env
```

## Activation

```bash
echo "ADAPTER_GLEAN_MCP=real" >> .env
echo "GLEAN_MCP_TOKEN=..." >> .env
echo "GLEAN_MCP_BASE_URL=https://api.glean.com" >> .env
docker compose up -d --build worker
```

## In-app usage (Next.js web app)

The web app exposes Glean as a first-class navigation target. Three surfaces:

| Surface | Path / trigger | What it does |
|---|---|---|
| Glean workspace | `/glean` (top nav) | Two tabs — **Search** (filtered by datasource preset) and **Ask Glean** (the assistant, with citations). |
| Command bar | `⌘K` / `Ctrl+K` from anywhere | Compact search overlay. Auto-focuses, pickers close on result click. Only registered when the status badge says Glean is reachable. |
| Account drill-in | "Search Glean" button next to the account name | Opens the command bar pre-filled with `accountName`. |

All three call the same server-side proxy routes, which speak Glean's
**MCP transport** (Streamable HTTP / JSON-RPC at `/mcp/<name>`) under
the hood — Glean's REST API requires admin scopes most users don't have,
whereas the MCP transport uses the same OAuth tokens Windsurf negotiates
on demand.

| Route | MCP tool | Notes |
|---|---|---|
| `POST /api/glean/search` | `search` | Datasource preset is sent as the `query` (the MCP tool ignores most filter args). |
| `POST /api/glean/chat` | `chat` | Buffered. We map our message log into `{message, context: string[]}`. |
| `POST /api/glean/document` | `read_document` | Batch — `{urls: string[]}`. Used by the search panel's "Preview" button. |
| `GET  /api/glean/health` | `search` (1-doc probe) | Drives the "Glean connected" badge in the top nav. |

`GleanClient` (`@mdas/adapter-shared/glean`) handles the MCP handshake:
`initialize` → `notifications/initialized` → `tools/call` per request,
auto-resuming via the `Mcp-Session-Id` header. Responses come back as
either JSON or SSE; both paths are parsed.

### Why a server proxy and not a browser-direct fetch?

1. The Glean bearer token has broad read access — keeping it server-side is non-negotiable.
2. Glean's MCP server does not advertise CORS for arbitrary origins; browser fetches would be blocked.
3. Centralizes `readOnlyGuard` + `intent` tagging in one place per Section 2.6 of the refactor prompt.

### Auth posture (`AUTH_MODE` env var)

#### Option A — `AUTH_MODE=none` (default, ships today)

Reuses the same `GLEAN_MCP_TOKEN` the worker uses. Single-user / localhost. Token never leaves the Node process. Results respect *that token's* Glean permissions (i.e. yours, since you minted the token from your Okta-SSO'd Glean session). Anyone else running the app would see your Glean view — fine for local-first MDAS, never deploy multi-user this way.

```bash
echo "AUTH_MODE=none" >> .env             # explicit; or omit (default)
echo "GLEAN_MCP_BASE_URL=https://yourtenant-be.glean.com/mcp/default" >> .env
make glean-token                          # see "Getting a token" below
```

Verify: top-right of the app should show `Glean connected ⌘K`.

##### Getting a token (non-admin path)

Glean's MCP server requires **OAuth 2.1 with Dynamic Client Registration
+ PKCE**, not static bearer tokens. Static token attempts get
`401 Invalid Secret`. Two ways to get a working token:

1. **Borrow Windsurf's token** (`make glean-token`).
   Windsurf already runs the OAuth flow via your Okta SSO and stores the
   resulting access token AES-encrypted in macOS Keychain. The
   `scripts/refresh-glean-token.mjs` helper decrypts it and writes the
   value into `.env` as `GLEAN_MCP_TOKEN`. Tokens have ~1-week TTL — re-run
   when `/api/glean/health` starts returning 401.
   - Requires Windsurf to have used a Glean MCP tool at least once (so
     the token is in its store).
   - macOS only. Linux/Windows would need libsecret/DPAPI equivalents.
   - **Don't commit `.env`** (already gitignored).
2. **Implement OAuth in the app itself** (Option B below). Right thing to
   do for any multi-user deployment.

##### Shell variable shadowing (gotcha)

If a `GLEAN_MCP_TOKEN` is exported in your interactive shell, it
**shadows** the value in `.env` because Docker Compose's `${VAR-}`
interpolation reads the host shell first. Symptoms: container logs say
`Invalid Secret` even after `make glean-token` reports success. Fix:

```bash
unset GLEAN_MCP_TOKEN
docker compose up -d --force-recreate web
```

The `make glean-token` target does the `unset` for you; running
`docker compose` directly does not.

#### Option B — `AUTH_MODE=okta` (per-user OAuth, scaffold today)

Each authenticated user signs into MDAS with their Okta identity, which is exchanged for a per-user Glean access token. Results respect *that user's* Glean permissions. Required for any multi-user deployment.

**Status: SCAFFOLD ONLY.** With `AUTH_MODE=okta` set, `/api/glean/*` returns HTTP 501 with the admin checklist in the body, and `/api/auth/okta` returns the same checklist as JSON. This is intentional — a half-wired NextAuth flow silently produces 401s; an explicit 501 is loud and actionable.

To finish wiring Option B:

1. **Okta admin** — register MDAS as an OIDC Web app with PKCE.
   - Sign-in redirect: `<APP_URL>/api/auth/callback/okta`
   - Sign-out redirect: `<APP_URL>/`
   - Grant types: Authorization Code + Refresh Token
   - Provides: `OKTA_ISSUER`, `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET`.
2. **Glean admin** — enable OAuth-mediated user-scoped access tokens for the new Okta client (Glean → Admin → Authentication → OAuth → "Allow on-behalf-of token issuance"). Grant the read scopes the worker uses today.
3. **MDAS engineer** — install `next-auth`, replace `apps/web/src/app/api/auth/okta/route.ts` with a NextAuth `[...nextauth]/route.ts` using the Okta provider (store `access_token` in JWT), and update `apps/web/src/lib/auth.ts::resolveGleanCredsForRequest` to pull the per-user token off the session instead of `GLEAN_MCP_TOKEN`.

Until step 3 lands, leave `AUTH_MODE=none`. The non-admin user path: ask the Okta admin to file the registration ticket, ship Option A locally in the meantime.

## Worker activation

After a refresh, verify in Postgres:

```sql
SELECT account_id,
       jsonb_array_length(payload->'accountPlanLinks') AS plan_count,
       jsonb_array_length(payload->'recentMeetings') AS meeting_count,
       payload->'lastFetchedFromSource'->>'glean-mcp' AS glean_at
  FROM snapshot_account
 WHERE refresh_id = (SELECT id FROM refresh_runs WHERE status='success' ORDER BY started_at DESC LIMIT 1)
   AND payload->'lastFetchedFromSource' ? 'glean-mcp'
 LIMIT 10;
```
