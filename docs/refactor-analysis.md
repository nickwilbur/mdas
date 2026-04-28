# MDAS Refactor Analysis — Phase 0

**Author:** Cascade (pair-programming with Nick Wilbur)
**Date:** 2026-04-28
**Scope:** Read-only audit of `packages/adapters/read/`, the canonical model, and the worker pipeline ahead of the `sf` CLI / Glean MCP refactor.
**Status:** Awaiting Nick's approval before any Phase 1 code changes.

---

## ⚠️ Prerequisite Question — Codebase Contradicts the Prompt

The prompt opens with: *"The current state: Glean and Salesforce adapters are working against real data."*

**The codebase disagrees.** Per Section 9 ("STOP and surface it as a question — don't paper over it"), I am surfacing this before proposing any refactor:

| Adapter | What the prompt says | What the code does |
|---|---|---|
| `salesforce` | working against real data | Issues SOQL queries via `fetch()` and **discards the results**, returning `{ accounts: [], opportunities: [] }` (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/index.ts:121-136`). Mapping layer is a `TODO`. |
| `glean-mcp` | working against real data | Returns hard-coded empty arrays with a comment that "MCP tools are meant to be used by the AI assistant (Cascade), not by the application code" (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/glean-mcp/src/index.ts:30-34`). |
| `cerebro-glean` | (other) | Smoke-tests the guard; returns `{}` (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/cerebro-glean/src/index.ts:38`). |
| `gainsight` | (other) | Smoke-tests the guard; returns `{}` (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/gainsight/src/index.ts:34`). |
| `staircase-gmail` | (other) | Returns `{}` (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/staircase-gmail/src/index.ts:18`). |
| `zuora-mcp` | (other) | Healthz check; returns `{}` (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/zuora-mcp/src/index.ts:32-35`). |

**The actual real-data flow** in production today is:

1. A human (you, in chat with Cascade) drives `mcp2_read_document` against Glean to dump opportunity payloads into `/tmp/opp_data/*.json`.
2. `@/Users/nick.wilbur/ai/mdas/scripts/import-real-opportunities.py` parses those Glean documents (regex-extracts the Sales Engineer User serialization from `snippet[0]`, joins to existing `snapshot_account` rows) and writes directly into `snapshot_opportunity` via `psql`.
3. The worker's `localSnapshotsAdapter` then preserves that payload across subsequent `runRefresh` cycles because no real adapter ever produces records.

So the "real data" you see in the UI is **Glean-sourced, Python-imported, and persisted by virtue of nothing overwriting it.** The TypeScript adapters are stubs.

### Why this matters for the refactor

The prompt's Phase 1 (Salesforce CLI refactor) and Phase 2 (Glean MCP refactor) both presume working SDK-level code to refactor *from*. There is none — Phase 1.4 ("audit every SOQL query the Salesforce adapter runs") would find three string constants none of whose results are read; Phase 2.1 ("move Cerebro reads to Glean MCP") would move zero lines of code because no Cerebro reads exist yet.

**This is a "build, then refactor"** situation, not a pure refactor. The proposal below treats it as such and is honest about it. **Please confirm the framing before I proceed.**

---

## Executive Summary — Top 5 Highest-Impact Recommendations

1. **Promote the Python ingestion script to a first-class TypeScript runtime adapter.** The `import-real-opportunities.py` flow is the only working end-to-end real-data path. Today it lives outside the worker pipeline, depends on a human running `mcp2_read_document` interactively, and bypasses `sourceLinks`/freshness tracking. The single biggest unlock is to port its parsing logic into a real `gleanOpportunityAdapter` callable by the worker via a shared `GleanClient` (Glean REST `/search` + `/getdocument`). **Without this, none of the rest of the refactor matters.**

2. **Wire `salesforceAdapter.fetch()` to actually return canonical records via `jsforce` (Bulk 2.0 for opps).** The SOQL constants already in `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/index.ts:15-58` already match Section 6 field-name truth. The gap is the runtime SDK + the SFDC→canonical mapper. Recommend `@jsforce/jsforce-node` (Option B in 1.4): no shell-out, native TS, supports OAuth refresh-token grant we already wire from env, and Bulk API 2.0 for the workshop history pull.

3. **Use `sf` CLI as a developer + CI tool only — never as a runtime dependency.** Concretely: schema validation in CI, generated field-map under `packages/adapters/read/salesforce/generated/`, sandbox fixture export for tests, local-dev auth via `sf org login web`. Production worker container stays slim (no node + sf binary). This matches the prompt's Section 7 anti-pattern guidance.

4. **Add per-source freshness + per-source error to canonical records before writing any adapter.** `lastFetchedFromSource` and `sourceErrors` (Section 3.3) are zero lines of code today. Adding them to `CanonicalAccount` / `CanonicalOpportunity` *first* makes every adapter implementation in Phases 1–2 honest about what it returned vs. what was preserved from a prior snapshot, and the UI's "Glean indexed at" pill becomes trivial.

5. **Standardize the `ReadAdapter` interface and the `RefreshContext` before touching adapter bodies.** Today every adapter receives `{ franchise }` only and there's no shared logger / shared client / rate limiter passed in. Each adapter creates its own `RateLimiter` (Zuora) or none (everyone else). Threading `RefreshContext` through `runRefresh` first makes every subsequent adapter rewrite cheaper and the audit log entries (Section 3.4) consistent.

**Combined effect**: do recommendations 4 + 5 first as the foundation (one PR each, ~150 LOC, zero behavior change), then 1, 2, 3 as feature work on top. This sequencing avoids touching every adapter twice.

---

## 0.1 Current Adapter Inventory

All adapters live under `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/<name>/src/index.ts`. Each is a single-file npm workspace package. Total lines of adapter code: **310 across 7 files**, of which roughly 180 are comments / SOQL constants and the rest is plumbing — i.e., almost no business logic exists yet.

| Adapter | LoC | Auth | HTTP/SDK | Field Mapping | Error/Retry | Tests | Drift vs. canonical |
|---|---|---|---|---|---|---|---|
| `salesforce` | 139 | OAuth refresh-token via env (`SALESFORCE_CLIENT_ID/SECRET/REFRESH_TOKEN/INSTANCE_URL`); raw `fetch` to `/services/oauth2/token` | Raw `fetch` + `readOnlyGuard`. No SDK. | None — three SOQL constants, results discarded, mapper is `TODO` | `if (!r.ok) throw` per call. No retry, no backoff, no token refresh on 401. | None | SOQL fields match Section 6 ✅; mapping doesn't exist so no drift to detect |
| `glean-mcp` | 45 | Bearer token (`GLEAN_MCP_TOKEN` + `GLEAN_MCP_BASE_URL`) | None executed. Comment explicitly says "MCP tools meant to be used by the AI assistant (Cascade), not by application code" | None | `try/catch` with `console.error`, returns empty | None | n/a — no records produced |
| `cerebro-glean` | 42 | Bearer (same as glean-mcp) | One `readOnlyGuard` smoke POST to `/rest/api/v1/search`; result ignored | None — comment says "Stubbed for v0" | Swallows all errors | None | `cerebroRiskCategory`, `cerebroRiskAnalysis`, `cerebroRisks` exist on `CanonicalAccount` (`@/Users/nick.wilbur/ai/mdas/packages/canonical/src/index.ts:76-79`) but adapter never populates them |
| `gainsight` | 38 | Bearer (Glean) | One smoke POST | None — "Stubbed for v0" | Swallows | None | `gainsightTasks: GainsightTask[]` declared on canonical (line 92), never populated |
| `staircase-gmail` | 22 | None plumbed | None | None | n/a (no calls) | None | `recentMeetings` declared, never populated |
| `zuora-mcp` | 39 | OAuth client-credentials (env `ZUORA_MCP_CLIENT_ID/SECRET/BASE_URL`) | Healthz GET via guard | None — "Zuora sandbox has no account data" | Swallows | None | `zuoraTenantId` declared on canonical, never populated |
| `local-snapshots` | 25 | DB | `@mdas/db` query | Trivial — passes through prior `payload` JSONB | Returns `{ accounts: [], opportunities: [] }` if no prior run | None | Pass-through; no drift |

**Shared utilities** (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/_shared/src/index.ts`):
- `readOnlyGuard(url, init)` — allowlists POST to `*.salesforce.com /query|search`, `api.glean.com|*.glean.com /search|chat|getdocument`, `*.zuora.com /query|api/data-query|/mcp`. GET is unconditionally allowed. **Solid.**
- `RateLimiter(maxPerWindow, windowMs)` — in-memory. Used by `zuoraMcpAdapter` only.

**Drift summary**: there is no field-level drift today **because adapters write nothing**. The canonical model already contains every field Phase 6 (Section 6) lists. The drift risk lives entirely in the future — the moment a Salesforce admin renames a field, our SOQL constants break silently.

---

## 0.2 Salesforce-Specific Analysis

| Question | Finding |
|---|---|
| How is SOQL composed? | **Hand-typed string literals**, three exported constants (`SOQL_ACCOUNTS`, `SOQL_OPPS`, `SOQL_WORKSHOPS`). `encodeURIComponent` for URL encoding. No bind variables, no string interpolation of inputs (the only filters are literal `'Expand 3'` etc.), so injection risk is currently zero. |
| Field-name maintenance | **Hand-maintained inside the SOQL strings.** Not duplicated elsewhere (the canonical model uses TS-camelCase names; the mapper from API name → canonical name doesn't exist yet). |
| Auth flow | **OAuth refresh-token grant** via raw `fetch` to `/services/oauth2/token`. Refresh token comes from `.env`. No JWT, no web-server flow, no session ID. |
| Connection pooling | **None.** `getAccessToken` is called fresh for every `runRefresh`; the access token is not cached. `fetch` uses Node's default keep-alive (one socket per query). |
| Rate limiting | **None.** Salesforce REST API limits would apply silently. |
| Bulk API 2.0 awareness | **None.** All three queries go through `/services/data/v59.0/query` (REST). The Workshop query (`LAST_N_DAYS:365` across all `Workshop_Engagement__c`) could easily exceed REST's 2,000-row default page and is a textbook Bulk 2.0 candidate. |
| Where SF REST could be replaced by `sf data query`? | **Nowhere at runtime** (anti-pattern per Section 7). For developer ad-hoc / CI schema work — yes (see 0.4). |
| Field-type validation | **None.** Returned records are typed `unknown[]` and immediately discarded; no TS compile-time guarantee that `Total_ACV__c` is `number`. |

**API version pinning**: hard-coded `v59.0` in `salesforceAdapter`. The org you authenticated against is on whatever Salesforce promotes — drift risk if a field used new in v60+ is added to our SOQL.

---

## 0.3 Glean-Specific Analysis

| Question | Finding |
|---|---|
| Tools/endpoints used | **Direct REST POST to `/rest/api/v1/search`** in `cerebro-glean` and `gainsight` (smoke checks only). `read_document`/`getdocument`, `chat`, `meeting_lookup`, `email_search_v2`, `employee_search`, `search_salesforce_with_soql` — **not used in code**. They are used by Cascade (the MCP client) at chat time to populate `/tmp/opp_data/*.json`, which the Python script ingests. |
| Integration mechanism | **Glean REST API** (Bearer token), routed through `readOnlyGuard`. No `@gleaninc/*` SDK installed. The `mcp2_*` tools available in this Cascade session are *separate* from the runtime — they're MCP tools the assistant calls, not bundled into the worker. |
| Citations / source links | `SourceLink { source, label, url }` exists on `CanonicalAccount` and `CanonicalOpportunity` (`@/Users/nick.wilbur/ai/mdas/packages/canonical/src/index.ts:8-22`). Used in two UI places: `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/accounts/[accountId]/page.tsx:185-200` and `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/OpportunitiesTable.tsx:233-235`. **No `citationId:snippetIndex` discipline today** — the Python importer captures raw URLs, never the Glean citation tuple. |
| Glean used where SF would be better? | **Yes — operationally.** The Python importer pulls structured opportunity field values out of Glean snippet text via regex (e.g., `extract_sales_engineer` regexing the `{attributes={type=User,...}}` Salesforce serialization that ended up in a Glean-indexed Salesforce snippet). This is exactly the anti-pattern in Section 2.5: using Glean for structured Salesforce data. Once the SF adapter is real, that regex path goes away. |
| SF used where Glean would be better? | Account plans / decks / QBR docs — `accountPlanLinks` exists on `CanonicalAccount` (line 95), populated only by the mock fixture. No adapter currently fetches them. Glean MCP `search` is the right tool. |

**Rate limits**: none documented in repo. The Glean MCP server-side limit is not visible to the adapter.

---

## 0.4 Refactor Opportunities — Salesforce CLI

| Item | Fit | Rationale |
|---|---|---|
| **CI schema validator (`scripts/validate-salesforce-schema.ts`)** | **Strong** | `sf sobject describe --json` is exactly what we need to assert every field in Section 6 still exists. Runs against sandbox so no prod load; fails CI on rename. Zero runtime impact. |
| **Generated field-map (`packages/adapters/read/salesforce/generated/field-map.ts`)** | **Strong** | One-shot codegen from `sf sobject describe`. Output checked in; PR review surfaces field renames as diffs. Adapter mapper imports from it. Decouples "what fields exist in the org" from "what fields the adapter reads". |
| **Sandbox fixture generator (`scripts/generate-mock-fixtures.ts`)** | **Strong** | `sf data export tree --query "...WHERE FranchisePicklist__c='Expand 3' LIMIT 12"` is faster and lower-friction than hand-writing 12 fixture accounts. PII anonymization happens at commit time. Gives us a real-shaped fixture set for tests. ⚠️ Note: the existing mock fixtures package was retired earlier today (commit `f7db84b`); this would resurrect a `fixtures/` directory but only for unit tests, not for the runtime worker. |
| **`sf org login web` for local-dev auth** | **Strong** | Eliminates the foot-gun of `SALESFORCE_REFRESH_TOKEN` in `.env`. The dev calls `make sf-login` once; `sf org display --json` returns a fresh access token on demand. Production stays on OAuth client-credentials in Docker secrets — explicitly *not* shipping `sf` into the container. |
| **`sf data query --bulk` for production runtime** | **Not a fit** | Section 7 anti-pattern. Use `@jsforce/jsforce-node` Bulk 2.0 client instead — no shell-out, no binary in the Docker image, native TS types. |
| **`sf data query --bulk` for dev fixture generation** | **Possible** | Acceptable in `scripts/generate-mock-fixtures.ts` because it's a one-shot dev tool. But `sf data export tree` already does this and emits TypeScript-friendly JSON, so prefer that. |
| **`sf sobject describe` for canonical type stub generation** | **Possible** | Could codegen TS interface stubs for raw SFDC records. Lower priority than the field-map; the canonical model already exists and is what UI/scoring reads. |
| **`sf` for ad-hoc refresh debugging** | **Strong (no code)** | Document in `docs/integrations/salesforce.md` how to use `sf data query --query "..." --target-org mdas-prod` to diff what the adapter sees vs. what production has. Pure documentation, no code. |

---

## 0.5 Refactor Opportunities — Glean MCP

| Item | Fit | Rationale |
|---|---|---|
| **All Cerebro reads via Glean** | **Strong** | Cerebro has no REST API; Glean is the only path. The current `cerebroGleanAdapter` is a stub — this is **build, not refactor**. The implementation: Glean `search` against the Cerebro custom datasource for each Expand 3 account name → `read_document` for full Risk Analysis text → parse Risk Category (Low/Medium/High/Critical, **direct passthrough per Section 10**) and the seven booleans. |
| **Account plans / decks / docs** | **Strong** | Free-text doc retrieval is exactly what Glean is for. New module `packages/adapters/read/glean-mcp/account-context.ts` returns `accountPlanLinks` for the canonical model. |
| **Cross-source evidence (Slack/Gmail/Calendar/Zoom)** | **Strong** | `meeting_lookup`, `email_search_v2`, `glean_search` with `app:slack` filter. Populates `recentMeetings`. Note: Section 2.3 caveats Gmail to accounts the user owns; surface that as a privacy guard at the adapter level. |
| **Citation discipline (`citationId:snippetIndex`)** | **Strong** | Today `SourceLink` is `{ source, label, url }` only. Add an optional `citationId` and `snippetIndex` for Glean-sourced links so the UI can deep-link with full provenance. Backwards-compatible. |
| **`search_salesforce_with_soql` at runtime** | **Not a fit** | The Python importer effectively does this (regex over Glean snippets that index Salesforce). Replace with the real SFDC adapter (rec. 2). Glean's SOQL tool stays available as a developer tool documented in `docs/integrations/glean.md`. |
| **Glean response caching per refresh** | **Strong** | Adapter `fetch()` is currently called once per refresh per source, but a sub-fetch (e.g., one Cerebro doc per account × 236 accounts) would be 236 round-trips. Cache `{ glean_doc_id: response }` keyed by `refreshId` for dedup. |
| **Surface "Glean indexed at" timestamp** | **Strong** | Goes hand-in-hand with `lastFetchedFromSource` (rec. 4). Glean's response includes the document's `updateTime`; pipe it into the canonical model. |

---

## 0.6 What Stays As-Is

Items I considered changing and explicitly rejected:

| Item | Why no change |
|---|---|
| **`localSnapshotsAdapter`** | It correctly does the one thing it should: load the previous snapshot for diff/preserve. No Section-3.1 interface change needed beyond the `RefreshContext` parameter. |
| **`readOnlyGuard` allowlist** | Already covers the four orgs we touch; the regex set is conservative. Adding new endpoints for `getdocument`/`chat` is already there (`api.glean.com /rest/api/v1/(search|chat|getdocument|documents)`). |
| **`RateLimiter`** | Trivial in-memory implementation is fine for v0; only used by Zuora. Replacing with `bottleneck` or similar is overkill until we have multi-process workers. |
| **CI guard `scripts/ci-guard.mjs`** | Already enforces no `adapters/write/`, no write-shaped MCP tool names, all read adapters export `isReadOnly`. Section 3.5 wants two more grep checks (write verbs in adapter source + Glean write tool names) — additive, not replacement. |
| **Canonical type field set (Section 6 fields)** | All present and correctly typed. Section 3.3's `lastFetchedFromSource` and `sourceErrors` are *additions*; everything else stays. |
| **`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/index.ts:15-58` SOQL constants** | They already match Section 6 field names exactly. Don't touch. The mapping layer below them is what's missing. |
| **API version `v59.0`** | Move to a single shared constant when the SDK migration happens, but the value itself is fine. Don't churn for churn's sake. |
| **Worker orchestrator (`@/Users/nick.wilbur/ai/mdas/apps/worker/src/orchestrate.ts`)** | The recent refactor (commits `f7db84b`, etc.) already does the right thing: `localSnapshots` first, real adapters only when env says `real`, no mock fallback. The `RefreshContext` thread-through is additive. |
| **Python `import-real-opportunities.py`** | Keep as a developer escape hatch / one-time bootstrap tool. Once `gleanOpportunityAdapter` is real, this script becomes obsolete but doesn't need to be deleted in this refactor. |

---

## 0.7 Risk Register

| Proposed change | Blast radius | Rollback | UI / score / snapshot impact |
|---|---|---|---|
| **Add `lastFetchedFromSource` + `sourceErrors` to canonical types** | All read adapters, all snapshot rows; touches `CanonicalAccount` & `CanonicalOpportunity` interfaces | Revert two commits; existing snapshots remain valid because new fields are optional with `Partial`/default values | UI: account drill-in adds freshness pills (additive, no breakage). Scoring: untouched. Snapshot: existing rows missing the fields → handle via default-when-absent in reader. **Backward compatible if defaulted.** |
| **`ReadAdapter<TInput, TOutput>` interface change + `RefreshContext`** | Every adapter signature changes (7 files); orchestrator changes | Revert. Each adapter can be migrated incrementally because the orchestrator can construct the `RefreshContext` and pass `{ franchise }` inside it without breaking signatures if we keep an overload during migration | UI: none. Scoring: none. Snapshot: none. **Pure plumbing.** |
| **Wire `salesforceAdapter` to actually return canonical records via `jsforce`** | Salesforce adapter only. New runtime dependency `@jsforce/jsforce-node` (~3 MB). | Set `ADAPTER_SALESFORCE=mock` (today's default with the env removed) → adapter returns `{}`, `localSnapshots` preserves whatever was last imported. | UI: account list / drill-in get fresher data; field shape unchanged. Scoring: same fields → same scores. Snapshot: new `refresh_run` rows. **Mostly low risk if the mapper round-trips through the existing Section 6 field names.** |
| **CI schema validator (`pnpm validate:schema`)** | New CI job hitting sandbox | Disable the job in CI config; mark non-blocking | UI: none. Scoring: none. Snapshot: none. **CI-only.** |
| **Generated field-map (`generated/field-map.ts`)** | One new generated TS file imported by adapter mapper | Delete file + revert imports | UI: none. Scoring: none. Snapshot: none. |
| **Sandbox fixture generator** | New script + new `fixtures/generated/` dir + new test fixtures | Delete | UI: none. Scoring: tests touch `getMockData` shapes — only matters if we wire fixtures back into tests, which we should avoid until needed |
| **Move local-dev auth to `sf org login web`** | `.env` no longer needs `SALESFORCE_REFRESH_TOKEN`; new helper resolves token from `sf org display --json` | Re-enable env-based auth path (keep both code paths during transition) | UI: none. Scoring: none. Snapshot: none. **Local dev only.** |
| **Build `cerebroGleanAdapter` to populate Risk Category/Analysis** | New runtime dep on Glean reachability for cerebro fields. Per Section 10, Risk Category is **direct passthrough** — no derivation | Disable adapter via env; UI shows null Risk Category (today's behavior) | UI: account drill-in shows real Risk Category badge + Risk Analysis text. Scoring: `RiskIdentifier.level` becomes 'Low'/'Medium'/'High'/'Critical' instead of 'Unknown'. Snapshot: new fields populated. **Watch for Cerebro freshness — must respect "weekly refresh" cadence per the Dec 11 2025 launch (handle stale data, surface freshness).** |
| **Build `glean-mcp/account-context.ts` adapter** | New module; populates `accountPlanLinks` | Drop the import from orchestrator | UI: account drill-in "Account Plans & Docs" section becomes populated. Scoring: none (not a scoring input). Snapshot: new field values. |
| **Build `glean-mcp/evidence.ts` adapter** | New module; populates `recentMeetings` | Drop the import | UI: account drill-in "Recent Meetings" populated. Scoring: none. Snapshot: new values. **Privacy: filter to user-owned accounts for Gmail per Section 2.3.** |
| **Add per-source freshness pills to Account Drill-In** | UI component change in `accounts/[accountId]/page.tsx` | Revert UI commit | UI: visible. Scoring: none. Snapshot: reads new fields from rec. above. |
| **Generate mock fixtures from sandbox** | New script; outputs to `fixtures/generated/`; tests stay unchanged unless we opt them in | Delete script + dir | UI: none. Scoring: tests untouched until we opt in. Snapshot: none. |
| **Bulk 2.0 for `Workshop_Engagement__c`** | Salesforce adapter only; jsforce client API surface | Fall back to REST query | UI: none. Scoring: same data. Snapshot: same shape. **Small risk of CSV-vs-JSON parsing mismatch in mapper — keep both code paths during migration.** |
| **Replace SOQL string concat with bind variables** | Salesforce adapter only | Revert | None — SOQL constants today have no interpolation, so this is hygiene-only. **Trivial.** |
| **Read-only CI checks: grep for `sf data create|update|delete|...` and write-shaped Glean tool names** | New `ci-guard.mjs` clauses | Revert | None. **CI-only.** |

---

## Sequencing Recommendation

1. **PR-1 (foundation, ~150 LOC, zero behavior change):**
   - Add `lastFetchedFromSource` + `sourceErrors` to canonical types (defaulted)
   - Define `RefreshContext` and update `ReadAdapter` signature
   - Migrate the 7 adapter signatures (still no behavior change)
   - Extended CI guards (write-verb grep)

2. **PR-2 (Salesforce dev tooling, no runtime change):**
   - `scripts/validate-salesforce-schema.ts` + CI job
   - `scripts/generate-sfdc-field-map.ts` + generated file
   - `Makefile` `sf-login` target + `.gitignore` updates
   - Docs: `docs/integrations/salesforce.md`

3. **PR-3 (Salesforce runtime — the real build):**
   - Add `@jsforce/jsforce-node`
   - Implement SFDC→canonical mapper using the generated field-map
   - Bulk 2.0 for workshops query
   - Token cache + 401 retry
   - Tests against fixtures

4. **PR-4 (Glean runtime — Cerebro):**
   - `GleanClient` shared module (REST `/search`, `/getdocument`)
   - Real `cerebroGleanAdapter` populating Risk Category passthrough + Risk Analysis
   - Per-refresh response cache
   - UI freshness pill
   - Tests w/ scrubbed fixtures

5. **PR-5 (Glean runtime — context + evidence):**
   - `account-context.ts` for plans/decks
   - `evidence.ts` for Slack/Gmail/Calendar/Zoom
   - UI updates in account drill-in

6. **PR-6 (cleanup):**
   - Delete or deprecate `import-real-opportunities.py`
   - `docs/refactor-changelog.md`
   - `docs/field-map.md` (generated)

Each PR ships independently; each is reversible.

---

## Open Questions for Nick

1. **Framing**: confirm the "build, then refactor" framing above. The prompt's Phase 1.4 / 2.1 wording presumes existing code to refactor; the codebase shows stubs. I want explicit go-ahead on that gap before writing any code.

2. **Sandbox availability**: is there a Zuora `mdas-sandbox` org I can `sf org login web` against for the schema validator (1.2) and fixture generator (1.5)? Or do we wire only `mdas-prod` and gate sandbox-only steps behind a CI env that you control?

3. **`@jsforce/jsforce-node` vs. raw `fetch`**: I'm proposing jsforce as the runtime SDK. The alternative is to keep raw `fetch` + `readOnlyGuard` and just add a thin token-cache + Bulk 2.0 wrapper ourselves (~100 LOC). jsforce adds a 3 MB dep. Preference?

4. **Python ingestion script fate**: keep, deprecate, or delete after the Glean adapter lands? My proposal is "deprecate, keep file in repo for one cycle, then delete" — matches Section 7's "no silent removal" ethos.

5. **Sequencing**: any objection to the PR-1 → PR-6 ordering above? I particularly want to confirm we land the canonical type additions (PR-1) *before* any adapter behavior changes — touching every adapter twice is the failure mode I most want to avoid.

6. **Write-verb grep specifics**: Section 3.5 wants grep for `sf data create|update|upsert|delete|import` and `connection.create|update|upsert|delete`. Should this fail CI on any *substring* match (loud, occasional false positive in comments), or AST-aware (more code, fewer false positives)? I lean substring for v0 with `// ci-guard:allow` escape comment if needed.

---

## Phase 0 Status

**Stopping here.** No code has been modified. `docs/refactor-analysis.md` is the only new file. Awaiting your written approval (chat comment or doc edit) on:
- The "build, then refactor" framing
- The top-5 + sequencing recommendations
- Answers to the six open questions

Once approved, Phase 1 (PR-1 foundation work) starts.

---

## PR-2 Drift Findings (2026-04-28)

The schema validator caught three drifts between **the prompt's Section 6 list** ("validated field names — authoritative") and the **actual `mdas-prod` org schema** (via `sf sobject describe`). Per Section 9 ("STOP and surface — don't paper over"), these are escalated rather than silently fixed:

| # | Section 6 says | `mdas-prod` actually has | Notes |
|---|---|---|---|
| 1 | `Account.Churn_Destription__c` | `Opportunity.Churn_Destription__c` (label "Churn Reason Summary") | Field exists in the org but on **Opportunity**, not Account. The typo'd "Destription" spelling is intentional in the org. |
| 2 | `Opportunity.SC_Next_Steps__c` | `Opportunity.SE_Next_Steps__c` (label "CSE Next Steps") | API name is `SE_…` not `SC_…`. There is also a `Derived_Next_Steps__c` and a `Next_Steps__c` — the correct one is the SE-prefixed custom field. |
| 3 | `Workshop_Engagement__c.Status` | `Workshop_Engagement__c.Status__c` (custom picklist) | The status field is custom (`__c` suffix), not the Salesforce-standard `Status` field. |

**Resolution decision needed from Nick** (one of):

- **(a) Trust the org**: update the SOQL constants and `EXPECTED_REFERENCES` to match the actual API names. Risk: silently masks any future intentional drift.
- **(b) Ask Salesforce admin** to align the org with Section 6 (rename / move fields). Risk: production process change required, possibly impacts other consumers of these fields.
- **(c) Hybrid**: accept the actual API names but track the discrepancy in a `docs/field-map.md` "Section 6 → org" alias table for visibility.

I recommend **(c)** — the validator is already loud, and a one-time alias table preserves the audit trail without forcing a rename request that may have downstream impact you can evaluate separately.

**State as of PR-2 commit**: validator currently fails for these three rows. PR-3 (runtime build) is **blocked on the resolution call** because the SOQL the adapter issues today references the same names Section 6 uses, and any of (a)/(b)/(c) requires editing the SOQL constants.
