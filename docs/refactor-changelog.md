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

## PR-6 — Cleanup, docs, deprecation

**Shipped:**

- `docs/field-map.md` — Section 6 → org alias table for the 3 drifts. Documents the closed-loop process for future schema changes (sf:fieldmap → sf:validate fails → SOQL or admin fix → green CI).
- `docs/integrations/salesforce.md` brought forward from PR-2 to current state (validator now a regression guard, Bulk 2.0 live, mapper wired).
- Deprecation header on `scripts/import-real-opportunities.py` — explicitly says "do not extend" and points at the TypeScript adapter as canonical.
- README adapter activation section expanded — three blocks (Salesforce / Cerebro / Glean) with all the env vars, behavior pointers, and references to the per-integration docs.
- This changelog.

## PR-7 — Gainsight adapter + tsc cleanup

**Commits**: `eeb0f5b..720cca2`

**Shipped:**

- `fix(tsconfig):` Excluded `apps/web` from the root `tsconfig.json` `include`. Next.js owns its own type-check via `next build` + `apps/web/tsconfig.json` (which has the `@/* → src/*` baseUrl alias the root config does not share). This ends the persistent `@/lib/read-model` "module not found" false positive that PR-3 through PR-6 commit messages had been carrying as a known caveat.
- `feat(gainsight):` Real Gainsight adapter via Glean's `app:gainsight` datasource (`type:calltoaction`). Verified the field shape live against Glean before writing code.
  - `mapper.ts:mapGainsightCta()` — pulls company name, CTA name, owner, status, due date, and CTA ID (parsed from the `/cta/<id>` URL segment) into a `GainsightCtaMapped` record. Snippet parser handles `Label: value` lines for fields that aren't on the matchingFilters facet.
  - `mapper.ts:normalizeName()` — fuzzy match key for the SFDC join. Strips `, Inc.`, `, LLC`, `GmbH`, etc. — Glean's Gainsight connector does NOT expose the SFDC Account ID (only Gainsight's internal GSID), so name match is the only available join.
  - `index.ts` — one-sweep search (CTA corpus is small), name-bucket, sort (open first, then due date asc), cap 25 per account. Emits Account partials with `gainsightTasks` + per-CTA `SourceLink` + `lastFetchedFromSource: { gainsight: refreshAt }`.
  - 11 mapper unit tests with a scrubbed CTA fixture covering full-row mapping, open/closed status detection, fallback paths, freshness extraction.
- `docs(gainsight):` New section in `docs/integrations/glean.md` with the facets-to-canonical mapping table, the cross-system-join rationale, and the sort/cap policy. README adapter-activation section gains a Gainsight block.

**Pending:**

- PR-7 smoke test against prod — same `GLEAN_MCP_*` blocker as PR-4 / PR-5.

## PR-8 — UI provenance surface + first half of smoke testing

**Commits**: `1182138..b034815` (UI), then `<this commit>` (table polish + tests).

The UI was previously rendering only the canonical fields PR-1 introduced; the new per-source provenance and the new Gainsight surface had no visual presence yet. PR-8 closes that gap end-to-end.

**Shipped — drill-in surface:**

- `FreshnessRow` pill row below the badge row. Each adapter that ran for this account renders as an emerald pill with relative time; pills older than 7 days dim to amber. Adapters in `sourceErrors` render red with ⚠ and the actual error in the tooltip. Adapters in `EXPECTED_SOURCES` (salesforce / cerebro / gainsight / glean-mcp) but absent from both maps render as grey "no data" pills — so a manager spots a missing integration without leaving the account view.
- `Gainsight Tasks (N)` Card between Workshops and Account Plans. Renders `CanonicalAccount.gainsightTasks` with status dot, owner, due date, and a deep-link to the Gainsight CTA URL when one is parseable from the account's `sourceLinks`.
- `Source Links` footer: `SourceLinksGrouped` replaces the flat list. Each source gets a section heading + count badge; items are alpha-sorted within their group; citation links (those with `citationId` / `snippetIndex`) get a `📍` indicator. Opportunity-level links are folded in with their `label` prefixed by the opp name.
- "CSE Sentiment Updated" header timestamp converted to `RelativeTime`.

**Shipped — accounts list:**

- `SourceDots` column on the `/accounts` table. Four-dot indicator per row (SF / Cerebro / Gainsight / Glean), color-matched to the freshness pills (emerald / amber / red / grey). Tooltip on each dot names the source and gives the full timestamp or error message. Lets a manager scan the table for "all-grey-third-dot" patterns indicating a degraded source.
- "Last Sentiment Update" column converted to `RelativeTime`.

**Shipped — admin:**

- `/admin/refresh` "Per-source freshness" card replaced. Was showing `run.completed_at` for every source, which masked partial failures. Now aggregates `payload->'lastFetchedFromSource'` across `snapshot_account` rows in the latest run, surfacing per-source MAX timestamp + COUNT(DISTINCT account_id touched). Implemented via `getPerSourceFreshness()` in `apps/web/src/lib/read-model.ts` (one SQL with `jsonb_each_text` + LATERAL).

**Shipped — supporting:**

- `apps/web/src/components/time.ts`: pure `relativeTimeLabel(iso, now)` + `isStale(iso, now)` + exported `STALE_AFTER_MS` constant. Date math extracted from the components so it's vitest-testable directly.
- `apps/web/src/components/time.test.ts`: 12 tests covering null/undefined/unparseable, "just now" edge, minute / hour / day granularity, "yesterday", 30-day cutoff, future-dated input, and the `STALE_AFTER_MS` boundary precision.
- `vitest.config.ts` `include` widened to `apps/**/*.test.ts` so app tests run alongside packages.
- Root `tsconfig.json` excludes `apps/web` so Next.js owns its own type-check (closes the persistent `@/lib/read-model` false positive that PR-3..PR-6 commit messages had been carrying as a known caveat). The fix landed at the start of this PR.
- `.gitignore`: added `**/*.tsbuildinfo`.

**Smoke (the half I can run today, no credentials needed):**

- Worker: a refresh runs end-to-end with the new adapter set in 491ms. All four credential-gated adapters (cerebro / gainsight / glean-mcp / zuora-mcp) cleanly no-op when `GLEAN_MCP_TOKEN` / `SALESFORCE_*` are absent. localSnapshots populates 236 accounts / 275 opportunities from the existing snapshot. No exceptions, no crashed orchestration.
- Web: all 8 routes return 200 (`/`, `/accounts`, `/accounts/[id]`, `/admin/refresh`, `/forecast`, `/hygiene`, `/wow`, `/opportunities`). Drill-in HTML inspection confirmed: 4 expected sources render as grey "no data" pills (correct for the no-creds state), the Gainsight Tasks panel renders `(0)`, Source Links uses the grouped layout with the "📍 = anchored citation" hint visible. `/accounts` table renders the new "Data" column with grey dots in every row.
- Build trap discovered + fixed: stale compiled `.js` / `.d.ts` files in the working tree (pre-existing, gitignored but present on disk from earlier `tsc -b` runs) were getting `COPY`'d into the Docker image first and shadowing the `.ts` sources at runtime. Cleaned with one `find … -delete`. Documented for the next dev who hits this.

**Test count**: 73 (was 61) — +12 from `time.test.ts`.

**Pending — the credentialed half of the smoke**: still needs `SALESFORCE_*` and `GLEAN_MCP_*` in worker env to verify the live data path turns the grey "no data" pills emerald and populates the Gainsight panel with real CTAs.

## PR-9 — data source precedence policy + spreadsheet-bridge revert

**Commits**: `61cfd83..2ea0371` (infra), `9d8abc5` (bridge — REVERTED), `<this commit>` (revert + policy).

Two related architectural items, recorded together because they were forced by the same conversation:

**The infra fix run that exposed the precedence question.** PR-8 wrapped with the credentialed half of the smoke test still pending. While trying to unblock it I uncovered three real infra bugs (committed as `61cfd83`, see PR-8 changelog) and added a startup health probe (committed as `2ea0371`). The infra is now sound — `.env` propagates to the container, Zscaler's TLS interception is trusted, and on every boot the worker prints a clean per-adapter ✓/✗ verdict.

**The spreadsheet-bridge experiment, then revert.** While the Glean service-account token was pending, I wrote a one-shot Cascade-relay (`9d8abc5`) that pulled the live "Cerebro Accounts with NASE" gdrive spreadsheet via Cascade's own Glean MCP integration, parsed 197 accounts into `seed/cerebro-snapshot.json`, and merged Cerebro Risk Category + AI risk analysis into the latest snapshot via SFDC-id join. This visibly populated the UI: 38 new Saveable Risk accounts surfaced, every drill-in showed real risk-analysis text. **The user then defined a firm rule prohibiting gdrive spreadsheets as data sources for this pipeline** — the bridge violated it. Reverted in this PR:

- **Deleted**: `scripts/import-cerebro-fixture.ts`, `seed/cerebro-snapshot.json`, the README "Cascade-relay" section, and the `seed/*.json` patterns from `.gitignore`. The bridge data had already merged into two refresh runs' `snapshot_account` and `account_view` rows; a one-shot `scripts/cleanup-spreadsheet-bridge.ts` strips the gdrive sourceLink, nulls `cerebroRiskCategory`/`cerebroRiskAnalysis`, removes `lastFetchedFromSource['cerebro']`, and re-runs scoring on every affected refresh. Idempotent. Discardable in a few weeks once the affected refreshes age out of /wow.
- **Result of cleanup**: risk source flipped back from `cerebro` (236 of 236) to `fallback` (236 of 236). Bucket distribution returned to baseline: 1 Saveable Risk, 11 Confirmed Churn, 224 Healthy. UI shows grey "no data" pills again — the correct surface until real adapter tokens land.

**Two firm policy rules** now codified in README and reflected in the orchestrator:

1. **Salesforce is the system of truth.** The orchestrator's adapter execution order was reversed: SF used to run first (and lose every shared-field merge to later adapters), now runs last so its values override every other source. New order: `localSnapshots → cerebro → gainsight → glean-mcp → staircase → zuora-mcp → salesforce`. `mergeAdapterResults()` is unchanged (naive last-write-wins spread); the change is in `selectActiveAdapters()`'s ordering of the `REAL_ADAPTERS` array.
2. **Glean is a backup and enrichment source, never primary, and never via gdrive spreadsheets.** Use Glean for fields no other system surfaces — AI risk analysis text, recent meeting summaries, account plan doc links, Slack snippets, Gainsight CTAs (where Gainsight has no direct API). The `cerebro-glean` adapter already enforces the no-spreadsheet rule via `datasources: ['cerebro']` on every query (the structured Cerebro corpus, not gdrive). Documented in the adapter's header comment and in README "Data sources & precedence".

**Side effect of the no-spreadsheet rule on Cerebro Risk Category**: Glean's `cerebro` datasource does not expose `Risk Category` or `Risk Analysis` in its `matchingFilters` for indexed Cerebro Health Risk pages. The adapter mapper acknowledges this at `mapper.ts:184-188` and intentionally leaves both fields null. Until a non-spreadsheet source for Risk Category exists, the UI's risk badge will show `via fallback` (the count-of-true-booleans heuristic) rather than `via cerebro`. The original PR-4.b design assumed a "Cerebro Risk Category passthrough from a canonical sheet" — that design is now obsolete. PR-4.b is closed without action.

**Verified**:

- `npm test` 73/73, ci-guard 4/4, tsc clean
- Worker boot probe correctly surfaces 4 ✗ rows: salesforce (env vars not set) + cerebro / gainsight / glean-mcp (token invalid)
- Cleanup script reduced to a no-op on second run (idempotent)

## Pending across the refactor (all credentials-blocked)

| Item | What's needed |
|---|---|
| PR-3.g smoke (Salesforce) | `SALESFORCE_CLIENT_ID/SECRET/REFRESH_TOKEN/INSTANCE_URL` in the worker container |
| PR-4 smoke (Cerebro) | `GLEAN_MCP_TOKEN` + `GLEAN_MCP_BASE_URL` |
| PR-5 smoke (Glean account-context + evidence) | same as PR-4 |
| PR-7 smoke (Gainsight) | same as PR-4 |
| PR-4.b (Cerebro Risk Category passthrough) | Nick to answer: canonical sheet URL, refresh cadence, perm scope |

## Test counts at each milestone

| After PR | Tests | Notes |
|---|---|---|
| PR-2 | 11 | scoring only |
| PR-3 | 27 | + 16 SF mapper |
| PR-4 | 37 | + 10 Cerebro mapper |
| PR-5 | 50 | + 13 Glean (5 context + 8 evidence) |
| PR-6 | 50 | docs-only PR |
| PR-7 | 61 | + 11 Gainsight mapper |
| PR-8 | 73 | + 12 RelativeTime / isStale (apps/web) |
