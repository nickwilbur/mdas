# Glean Integration

Glean is the federation layer behind multiple MDAS adapters:

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
