# Refactor Changelog

PR-by-PR summary of the 2026-04 refactor that turned the MDAS adapter layer from stubs (returning `{}`) into a real, read-only, multi-source data integration. Use this doc as an audit trail when reviewing the canonical model, the adapter contracts, or the read-only invariants.

Each section links to the GitHub commit hash and lists what shipped, what was deliberately deferred, and what blockers remain.

## PR-1 — Architecture foundations & read-only invariants

**Commits**: pre-refactor baseline (already on master before this work began)

**Already in place when the refactor started:**

- Canonical types in `packages/canonical` (`CanonicalAccount`, `CanonicalOpportunity`, `MeetingSummary`, `CerebroRisks`, `SourceLink`, `RefreshContext`, etc.).
- `AdapterFetchResult` contract — every adapter returns `{ accounts: Partial<CanonicalAccount>[], opportunities: Partial<CanonicalOpportunity>[] }`.
- `mergeAdapterResults()` in the worker — spreads partials onto a baseline (typically `localSnapshots`) so adapters compose without clobbering each other's fields.
- `readOnlyGuard()` in `packages/adapters/read/_shared` — wraps every outbound HTTP. Permits GET/HEAD; POST only to a small allowlist of search/query endpoints.
- `RiskIdentifier { level, source: 'cerebro' | 'fallback', rationale }` — the scoring layer's contract for Section 10's "passthrough vs fallback" rule.

PR-1 was not changed by this refactor — it's the foundation everything else builds on.

## PR-2 — Salesforce schema validation tooling

**Commits**: `4dab203..a5b1204`

**Shipped:**

- `make sf-login` / `make sf-fieldmap` / `make sf-validate` (and the equivalent `npm run sf:*` scripts).
- `scripts/generate-sfdc-field-map.ts` — calls `sf sobject describe --json` on `Account`, `Opportunity`, `Workshop_Engagement__c` and emits `packages/adapters/read/salesforce/generated/field-map.ts` (checked in; PR diffs surface schema renames).
- `scripts/validate-salesforce-schema.ts` — cross-checks every SOQL field reference in the adapter against the generated field-map; fails CI on any drift.
- `docs/integrations/salesforce.md` — runbook for org auth, validation, regen, debugging recipes.
- `docs/refactor-analysis.md` — surfaced 3 fields where the prompt's Section 6 disagreed with the prod org schema, with three resolution options (a/b/c) for Nick to choose.

**Drifts surfaced** (resolved in PR-3 with option c):

- `Account.Churn_Destription__c` actually lives on `Opportunity` in the org.
- `Opportunity.SC_Next_Steps__c` is `Opportunity.SE_Next_Steps__c` (SC → SE rebrand).
- `Workshop_Engagement__c.Status` is `Workshop_Engagement__c.Status__c` (custom field).

## PR-3 — Salesforce runtime adapter

**Commits**: `a5b1204..30d87e3`

**Shipped:**

- `chore(deps):` `@jsforce/jsforce-node ^3.6.0` added to `packages/adapters/read/salesforce/package.json`. Selected over hand-rolled fetch + OAuth wrapper for native refresh-token flow, Bulk 2.0 client (`conn.bulk2.query`), and auto-pagination.
- `feat(salesforce):` `SalesforceClient` (`client.ts`) — read-only wrapper exposing only `query()` and `bulkQuery()`. No create/update/upsert/destroy methods exist (CI guard greps for write verbs).
- `feat(salesforce):` `mapper.ts` — type-safe `SfdcAccountRow` / `SfdcOpportunityRow` / `SfdcWorkshopRow` interfaces with picklist mappers, ATR fallback hierarchy, datetime → date trimming, and the cross-object projection of `Opportunity.Churn_Destription__c` → `Account.churnReasonSummary` (resolves the Section 6 vs org drift).
- `feat(salesforce):` `salesforceAdapter.fetch()` wired — 3 parallel SOQL queries, Bulk 2.0 escalation for Workshop above 1500 rows (heuristic `BULK_THRESHOLD`), populates `lastFetchedFromSource: { salesforce: refreshAt }`.
- 16 unit tests for the mapper. Caught one Number('') === 0 footgun in `Stage_Num__c` parsing.
- `docs/field-map.md` deferred to PR-6.

**Verified:**

- `tsc --project tsconfig.json` clean.
- `node scripts/ci-guard.mjs` ✅.
- `npm run sf:validate` ✅ — 61 fields all present.
- `npm test` ✅ — 27/27 tests.

**Pending:**

- PR-3.g: smoke test against `mdas-prod` requires Nick to provide `SALESFORCE_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN` / `INSTANCE_URL` to the worker container or the developer machine.

## PR-4 — Cerebro adapter via Glean

**Commits**: `30d87e3..92ae633`

**Section 9 finding surfaced before writing code:**

The prompt's Section 2.1 assumed Glean's `app:cerebro` exposes Risk Category + Risk Analysis. Verified via `mcp2_search` + `mcp2_read_document` that **only** the 7 risk booleans + sub-metrics + customer name + SFDC Account ID + freshness timestamp are in the Glean index. Risk Category (Low/Medium/High/Critical) and Risk Analysis prose appear to live in a curated weekly Google Sheet (`Cerebro Accounts with NASE`), which is a separate retrieval path. Nick was asked three open questions about that sheet (canonical URL, refresh cadence, perms); answers pending.

**Shipped (Path A):**

- `feat(glean):` shared `GleanClient` at `packages/adapters/read/_shared/src/glean.ts` — `search` / `searchAll` / `getDocuments` / `healthCheck` with per-refresh in-memory doc cache. No write methods. All POSTs route through `readOnlyGuard`.
- `feat(cerebro):` `mapper.ts` — parses `richDocumentData.facets.{keywordFacets, intFacets}` for the 7 booleans + 16 sub-metric integers + 8 has-flags. Falls back to lowercase `matchingFilters` keys when richDocumentData is absent. URL-pattern fallback for accountId. Emits `SourceLink` with optional `citationId`/`snippetIndex` per the citation discipline (Section 2.4).
- `feat(cerebro):` `cerebroGleanAdapter` — two-pass `searchAll` then `getDocuments(50)` chunks. Per-source error isolation. Stamps `lastFetchedFromSource: { cerebro: refreshAt }`.
- `feat(cerebro):` 10 mapper tests with a scrubbed Glean fixture. Includes a regression assertion that `cerebroRiskCategory` and `cerebroRiskAnalysis` stay undefined (Section 10 contract guard).
- `docs/integrations/cerebro.md` — full field inventory, the Risk Category absence callout, the planned Path B (gdrive sheet adapter), activation runbook.

**Pending:**

- Path B (Risk Category passthrough from gdrive sheet) — blocked on Nick's three questions.
- PR-4 smoke test — blocked on `GLEAN_MCP_TOKEN` / `GLEAN_MCP_BASE_URL` reaching the worker.

## PR-5 — Glean account-context + evidence

**Commits**: `92ae633..a664848`

**Shipped:**

- `feat(glean-mcp):` `account-context.ts` (`fetchAccountContext`) — gdrive search for plans / QBRs / business reviews per account, post-filtered with a 6-keyword allowlist (`account plan`, `qbr`, `business review`, `success plan`, `plan`, `review`) to drop invoices and other gdrive noise. Top N = 5 default.
- `feat(glean-mcp):` `evidence.ts` (`fetchAccountEvidence`) — three parallel datasource searches per account (calendar / slack / gmail), top-3 each, recency-windowed (default 30 days). Per-source error isolation.
- **Privacy guard for Gmail** — Gmail searches are scoped to `from:support@staircase.ai` (system-generated digests), and the adapter never calls `getDocument()` on Gmail URLs. Summary is built from the truncated snippet Glean's search response already returned (which Glean has access-checked at index time). Rule enforced in three places in code; documented in `docs/integrations/glean.md` with the planned relaxation when MDAS gains per-user identity.
- `feat(glean-mcp):` rewired `index.ts` — discovers prior accounts via `latestSuccessfulRun()` + `readSnapshotAccounts()`. Bounded concurrency via `mapWithConcurrency` (default `GLEAN_CONCURRENCY=5`). Emits Account partials only when at least one sub-fetch returned data.
- 13 unit tests across the two modules — cover plan-shape filter correctness, attendee dedup, recency windowing, single-source-failure isolation, citation preservation, lastFetchedFromSource preservation across multiple adapters.
- `docs/integrations/glean.md` — adapter map, query templates, privacy rationale, concurrency tuning, activation runbook.

**Pending:**

- PR-5 smoke test — same `GLEAN_MCP_*` blocker as PR-4.

## PR-6 — Cleanup, docs, deprecation (this PR)

**Shipped:**

- `docs/field-map.md` — Section 6 → org alias table for the 3 drifts. Documents the closed-loop process for future schema changes (sf:fieldmap → sf:validate fails → SOQL or admin fix → green CI).
- `docs/integrations/salesforce.md` brought forward from PR-2 to current state (validator now a regression guard, Bulk 2.0 live, mapper wired).
- Deprecation header on `scripts/import-real-opportunities.py` — explicitly says "do not extend" and points at the TypeScript adapter as canonical.
- README adapter activation section expanded — three blocks (Salesforce / Cerebro / Glean) with all the env vars, behavior pointers, and references to the per-integration docs.
- This changelog.

## Pending across the refactor (all credentials-blocked)

| Item | What's needed |
|---|---|
| PR-3.g smoke | `SALESFORCE_CLIENT_ID/SECRET/REFRESH_TOKEN/INSTANCE_URL` in the worker container |
| PR-4 smoke | `GLEAN_MCP_TOKEN` + `GLEAN_MCP_BASE_URL` |
| PR-5 smoke | same as PR-4 |
| PR-4.b (Cerebro Risk Category passthrough) | Nick to answer: canonical sheet URL, refresh cadence, perm scope |

## Test counts at each milestone

| After PR | Tests | Notes |
|---|---|---|
| PR-2 | 11 | scoring only |
| PR-3 | 27 | + 16 SF mapper |
| PR-4 | 37 | + 10 Cerebro mapper |
| PR-5 | 50 | + 13 Glean (5 context + 8 evidence) |
| PR-6 | 50 | docs-only PR |
