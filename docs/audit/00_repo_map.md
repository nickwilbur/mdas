# 00 — Repo Map (CP-1 Discovery)

**Owner:** Cascade (audit pass for CSE Manager Tool uplift, Expand 3 pilot)
**Date:** 2026-04-28
**Mode:** Read-only. No code changes in this phase.
**Engagement decision recorded:** Q1 of §12 → **Option (c) Hybrid**. Phases 1–3 stay read-only; writes deferred to a future `apps/actions` service. The CI-enforced read-only invariant in `scripts/ci-guard.mjs` and `mcp.config.json` is preserved.

---

## 1. Stack inventory (verified, not guessed)

| Layer | Choice | Evidence |
|---|---|---|
| Monorepo | npm workspaces | `package.json:5-10` |
| Language | TypeScript 5.4 (strict) | `tsconfig.base.json:7`, `package.json:28` |
| Web | Next.js 14.2 App Router, React 18.3, Tailwind 3.4, lucide-react, clsx | `apps/web/package.json:11-16` |
| Worker | tsx-run Node, ESM, `pg` | `apps/worker/package.json:5-23` |
| DB | Postgres 16, JSONB-heavy | `docker-compose.yml:3`, `packages/db/migrations/0001_init.sql` |
| Queue | Postgres `LISTEN/NOTIFY` + `refresh_jobs` row | `apps/worker/src/main.ts:62-68`, `packages/db/src/index.ts:271-298` |
| Tests | vitest 1.5 (`packages/**/*.test.ts`, `apps/**/*.test.ts`) | `vitest.config.ts:5` |
| "Lint" | `tsc -b --pretty` only — **no ESLint, no Prettier** | `package.json:17` |
| CI | GitHub Actions; matrix: `ci-guard → tsc → vitest → migrate → seed → next build → smoke curl` | `.github/workflows/ci.yml:30-57` |
| Container | `docker compose` for `db` + `web` + `worker`; corp-CA mount for Zscaler | `docker-compose.yml:71-77` |
| Read-only enforcement | `scripts/ci-guard.mjs` (4 checks: no `adapters/write/`, no write-verb MCP tools, every adapter exports `isReadOnly: true`, no jsforce/sf-CLI/REST write verbs in adapter source) | `scripts/ci-guard.mjs:24-115` |

**Gap vs. §3 ask:** there is no ESLint, no Prettier, no E2E framework (Playwright/Cypress), no a11y harness (axe/pa11y), no Lighthouse CI, no bundle-size budget, no perf budget. CI smoke is `curl -fsS` on five routes — not real assertion. These are P1 audit items.

---

## 2. Architecture sketch

```mermaid
flowchart LR
    subgraph Sources["External read-only sources"]
        SF[Salesforce<br/>jsforce REST + Bulk 2.0]
        Cerebro[Cerebro<br/>via Glean MCP]
        Gainsight[Gainsight<br/>via Glean MCP]
        GleanX[Glean MCP<br/>cross-source synthesis]
        Stair[Staircase.AI<br/>via Gmail summaries]
        Zuora[Zuora Remote MCP<br/>OAuth client_credentials]
    end

    subgraph Worker["apps/worker"]
        Listen["LISTEN refresh"] --> Drain[claimNextJob]
        Drain --> Orch["orchestrate.runRefresh"]
        Orch --> Adapters["selectActiveAdapters()<br/>localSnapshots → cerebro → gainsight → glean-mcp → staircase → zuora-mcp → SF<br/>(env-flag gated, last-write-wins merge)"]
        Adapters --> Snap[writeSnapshotAccounts/Opps]
        Snap --> Score["scoring.buildAccountView<br/>+ rankAccountViews + diffAll"]
        Score --> View[writeAccountViews]
    end

    subgraph DB[(Postgres 16)]
        RR[refresh_runs]
        SA[snapshot_account JSONB]
        SO[snapshot_opportunity JSONB]
        AV[account_view JSONB]
        AL[audit_log]
        RJ[refresh_jobs]
    end

    subgraph Web["apps/web (Next.js 14)"]
        Pages["/, /accounts, /accounts/[id],<br/>/opportunities, /wow, /hygiene,<br/>/forecast, /admin/refresh"]
        ReadModel["lib/read-model.ts<br/>(server-only)"]
        ApiRefresh["POST /api/refresh<br/>→ enqueueRefreshJob + pg_notify"]
        ApiForecast["POST /api/forecast<br/>→ generateWeeklyForecast"]
    end

    Sources --> Adapters
    Snap --> SA
    Snap --> SO
    View --> AV
    Orch --> RR
    Orch --> AL
    ApiRefresh --> RJ
    RJ -. NOTIFY refresh .-> Listen
    Pages --> ReadModel
    ReadModel --> AV
    ReadModel --> SA
    ReadModel --> SO
    ApiForecast --> ReadModel
```

**One-paragraph summary.** The web app is purely a server-rendered reader over Postgres; it never calls any external system. The worker is the only process that touches upstream data. A "refresh" is a complete re-fetch (no incremental sync); the seven canonical adapters run in parallel inside `Promise.all`, each with a 25 s timeout, and the merge step is a deterministic `Map.set`-spread per object key with adapters scheduled later "winning" on shared canonical fields. Salesforce is scheduled last to enforce its system-of-truth role. Each refresh writes three append-only tables (`snapshot_account`, `snapshot_opportunity`, `account_view`); the previous run is preserved (12-run retention) so WoW diffs are computed by re-reading both snapshots, not from a change-log. UI never sees raw adapter output — it only reads `account_view.view_payload`, which is a fully-baked `AccountView` object including bucket, risk identifier, upsell band, hygiene violations, and `priorityRank`.

---

## 3. Data model (canonical, source of truth = `packages/canonical/src/index.ts`)

| Entity | Type alias | Key fields | Source(s) | Freshness SLA evidence |
|---|---|---|---|---|
| Account | `CanonicalAccount` (`canonical/src/index.ts:93-146`) | `accountId`, `salesforceAccountId`, `accountName`, `franchise`, `cseSentiment` (`Green\|Yellow\|Red\|Confirmed Churn\|null`), `cseSentimentCommentary`, `cseSentimentCommentaryLastUpdated`, `cerebroRiskCategory` (`Low\|Medium\|High\|Critical\|null`), `cerebroRisks` (7 booleans), `cerebroSubMetrics` (free dict), `allTimeARR`, `activeProductLines`, `engagementMinutes30d/90d`, `isConfirmedChurn`, `churnReason`, `churnReasonSummary`, `churnDate`, `gainsightTasks[]`, `workshops[]`, `recentMeetings[]`, `accountPlanLinks[]`, `sourceLinks[]`, `lastFetchedFromSource?` (per-source ISO map), `sourceErrors?` | SF (sentiment, ARR, owner, CSE assignment, churn fields), Cerebro/Glean (risk booleans, sub-metrics — risk **category/analysis NOT exposed by Glean**, see §1 of memory), Gainsight/Glean (CTAs), Glean-MCP (account plans, recent meetings) | 14d Red/Yellow + 30d Green for sentiment commentary, encoded in `scoring/src/index.ts:187-200` |
| Opportunity | `CanonicalOpportunity` (`canonical/src/index.ts:148-186`) | `opportunityId`, `stageNum`, `closeDate`, `acv`, `availableToRenewUSD`, `forecastMostLikely`, `forecastMostLikelyOverride`, `mostLikelyConfidence`, `forecastHedgeUSD`, `acvDelta`, `knownChurnUSD`, `productLine`, `flmNotes`, `slmNotes`, `scNextSteps`, `salesEngineer`, `fullChurnNotificationToOwnerDate`, `fullChurnFinalEmailSentDate`, `churnDownsellReason` | Salesforce only | none today |
| Account-level view | `AccountView` (`canonical/src/index.ts:307-319`) | `bucket`, `risk` (`RiskIdentifier`), `upsell` (`UpsellAssessment`), `hygiene` (`{score, violations[]}`), `priorityRank`, `daysToRenewal`, `atrUSD`, `acvAtRiskUSD`, `changeEvents[]` | Computed in `scoring.buildAccountView` | Recomputed every refresh |
| Risk identifier | `RiskIdentifier` | `level: 'Low'\|'Medium'\|'High'\|'Critical'\|'Unknown'`, `source: 'cerebro'\|'fallback'`, `rationale` | Cerebro Risk Category passthrough; fallback to count-of-true Cerebro booleans, then sentiment | `scoring/src/index.ts:35-87` |
| Upsell | `UpsellAssessment` | `score 0-100 (additive cap 100)`, `band: Watch\|Qualified\|Active\|Hot`, `signals[]` | 7 signals (open Upsell/CrossSell, recent workshop, Cerebro risk improved, PBU >70%, sentiment Green & ACVΔ ≥ 0, whitespace <3 products, exec meeting last 30d) | `scoring/src/index.ts:105-175` |
| Hygiene | `HygieneViolation[]` | 6 rules: stale_sentiment_commentary, missing_next_action, no_workshop_logged, missing_flm_notes_on_risk, no_exec_engagement, get_to_green_plan_missing | `scoring/src/index.ts:179-275` |
| Change event | `ChangeEvent` | `field`, `oldValue`, `newValue`, `category` (`risk\|sentiment\|forecast\|hygiene\|workshop\|churn-notice`), `label` | `scoring/diffAll` over consecutive snapshots | `scoring/src/index.ts:362-527` |
| Refresh run | `RefreshRun` (`db/src/index.ts:31-41`) | id, started_at, completed_at, status (`running\|success\|partial\|failed`), `sources_attempted/succeeded`, `row_counts`, `error_log` | worker | append-only, last 12 retained |
| Audit log | rows in `audit_log` | actor, event, details JSONB | refresh lifecycle + `manual:nick` triggers | append-only |

**Per-source freshness model.** Each adapter is expected to stamp `account.lastFetchedFromSource[source] = ctx.asOf.toISOString()` and (on partial failure) `account.sourceErrors[source] = msg`. UI surfaces this via `<SourceDots />` (`apps/web/src/components/ui.tsx:245-281`) and `<FreshnessRow />`. **Coverage gap:** I did not yet verify every adapter actually writes these fields — that's a P1 audit item.

---

## 4. Page / route inventory

| Route | File | Persona action | Data dependency | Empty-state behavior today |
|---|---|---|---|---|
| `/` Dashboard | `apps/web/src/app/page.tsx` | "Glance: how big is my book and what's hot?" 5 stat tiles + 3-column lists (Confirmed Churn / Saveable Risk / Upsell Hot+Active) | `getDashboardData()` (`account_view` filtered to `franchise === 'Expand 3'`) | "No data yet" page if no successful refresh; per-column "None." literal — **no cause/fix link** |
| `/accounts` | `apps/web/src/app/accounts/page.tsx` | Ranked action list, fiscal-quarter filter (URL `?quarters=`) | Same as `/` | Quarter filter URL-shareable ✓ |
| `/accounts/[accountId]` | `apps/web/src/app/accounts/[accountId]/page.tsx` (257 lines) | Drill-in: Cerebro analysis + 7 booleans + sub-metrics, sentiment commentary, opps with FLM/SC notes (each opp shows ⚠ if FLM blank), workshops, meetings, Gainsight tasks, account plans, WoW changes, hygiene, source links | `getAccount(accountId)` | Opportunity ⚠ for missing FLM Notes ✓; everything else `—` or "No X for this account" without cause-of-emptiness |
| `/opportunities` | `apps/web/src/app/opportunities/page.tsx` | Sortable, multi-filter table (CSE, stage, type, product, FY, qtr); window: -15m/+36m | `getAllOpportunities()` reads `snapshot_opportunity` | "No opportunities found" |
| `/wow` | `apps/web/src/app/wow/page.tsx` | Diff between current and previous successful run, grouped 6 categories | `getWoWChangeEvents()` reads two snapshots and re-runs `diffAll` | "—" header IDs and "None." per category |
| `/hygiene` | `apps/web/src/app/hygiene/page.tsx` | Per-CSE rollup + flat violations table | `getDashboardData()` filtered to `hygiene.score > 0` | (empty if all clean — no informative empty state) |
| `/forecast` | `apps/web/src/app/forecast/page.tsx` + `ForecastClient.tsx` | Generate weekly markdown, copy/download | `POST /api/forecast` → `generateWeeklyForecast(views, events, asOfDate)` | "— click Generate Update to render —" |
| `/admin/refresh` | `apps/web/src/app/admin/refresh/page.tsx` | Per-source freshness card + last 20 runs table + audit tail | `getRecentRuns(20)`, `getAuditTail(80)`, `getPerSourceFreshness()` | "No per-source freshness recorded yet" with cause text ✓ |

**APIs (server):**
- `POST /api/refresh` → enqueues a job, `pg_notify('refresh', jobId)`. Worker drains. No streaming/poll endpoint.
- `POST /api/forecast` → returns generated markdown.
- `GET /api/refresh/[jobId]` (file exists, not yet read).

**Missing routes vs. §4 ask of the prompt:**
- No "What changed in my book this week, and what do I need to do about it?" landing pane (the dashboard is org-roll-up, not action-list).
- No dark-account view (engagement decay).
- No data-quality / staleness-by-ARR exposure surface.
- No exec/QBR mode export.
- No Clari-paste view.
- No save-play workflow surface.
- No whitespace surface (the upsell column is just band+score, not TAM/ESA/product-attach gaps).

---

## 5. Integration inventory

Adapter execution order is **`localSnapshots → cerebro → gainsight → glean-mcp → staircase → zuora-mcp → salesforce`** (`apps/worker/src/orchestrate.ts:58-65`). Each is opt-in via `ADAPTER_*=real`; default in compose and CI is `mock` for everything (`docker-compose.yml:25-30`, `.github/workflows/ci.yml:23-28`). The localSnapshots adapter is always active and acts as a baseline for unattended refreshes.

| Adapter | LOC (src) | Auth | Sync cadence | Failure mode evidence | Rate-limit / idempotency story |
|---|---|---|---|---|---|
| `salesforce` (`packages/adapters/read/salesforce/src/`) | client 6kB + mapper 11.6kB + index 7.8kB | OAuth refresh-token (Connected App) | Manual / per-refresh; Bulk 2.0 auto-escalation >1500 rows | Per-account error swallowed via Promise.race timeout 25s in orchestrator (`orchestrate.ts:202-227`); validator script `scripts/validate-salesforce-schema.ts` checks 61 SOQL fields against `sf sobject describe` | None visible at adapter level; jsforce default |
| `cerebro-glean` | index 5.5kB + mapper 7.2kB | Glean MCP bearer | Per-refresh | Risk Category/Analysis **not exposed** by Glean → fallback path in `scoring.getRiskIdentifier`. UI labels badge `via fallback` (per memory + README §"side effect"). | None |
| `gainsight` | index 5.7kB + mapper 4.4kB | Glean MCP bearer (no direct Gainsight API) | Per-refresh | Joins to canonical Account by case-insensitive name match — fragile | None |
| `glean-mcp` | index 5.2kB + account-context 3.9kB + evidence 7.5kB | Glean MCP bearer | Per-refresh, `GLEAN_CONCURRENCY=5` default | Privacy guard on Staircase Gmail summaries (metadata only) | Concurrency-controlled |
| `staircase-gmail` | (1 file) | Gmail (no Glean connector for Staircase exists today) | Per-refresh | — | — |
| `zuora-mcp` | (1 file) | OAuth client_credentials | Per-refresh | Quota 5000 req/tenant/month, "limited client-side" per README | client-side throttle |
| `local-snapshots` | (1 file) | DB read | Per-refresh | Always present as baseline | n/a |

**Integrations explicitly absent today** (vs. §8 of prompt): **Clari** (no adapter at all — forecast is generated and pasted into Clari, not ingested), **Slack** (only via Glean MCP), **Zoom** (only via Glean MCP), **Gmail/Calendar** as direct sources (only via Glean MCP), **Staircase health/relationship/engagement scores** (only Gmail summaries via Glean — no API integration). LinkedIn/news/M&A enrichment is **not present at all** — the §4.4 "stakeholder churn" and "M&A signal" weights have no source.

**Memory-confirmed rules** (carried into the audit):
1. **Salesforce wins on shared fields** — last-write-wins merge with SF scheduled last.
2. **Glean is backup/enrichment only**, never primary; spreadsheets discovered via Glean's `gdrive` corpus are explicitly **out of scope**.
3. **Cerebro Risk Category/Analysis** is currently sourced from neither Glean nor a direct Cerebro API (no public API exists) — the UI's `via fallback` label is the correct interim state, **not a bug**.

The Cascade-relay bridge described in `README.md:253-286` is a **one-shot manual import** for environments where SF/Glean tokens haven't landed yet. It does not run in production — it's a script the human operator invokes. Out of scope for the rebuild unless the user reactivates it.

---

## 6. Test coverage snapshot (run 2026-04-28)

```
vitest run: 8 files, 83 tests passed, 0 failed, 479ms
  packages/scoring/src/index.test.ts                              13
  packages/adapters/read/salesforce/src/mapper.test.ts            16
  packages/adapters/read/salesforce/src/client.test.ts             8
  packages/adapters/read/cerebro-glean/src/mapper.test.ts         10
  packages/adapters/read/gainsight/src/mapper.test.ts             11
  packages/adapters/read/glean-mcp/src/account-context.test.ts     5
  packages/adapters/read/glean-mcp/src/evidence.test.ts            8
  apps/web/src/components/time.test.ts                            12
```

- **No coverage tool configured.** vitest config has no `coverage` block (`vitest.config.ts`).
- **No DB integration tests, no E2E tests, no UI component tests beyond `time.test.ts`.**
- The seven UI pages (`apps/web/src/app/**/page.tsx`) have **zero unit/integration tests**; CI smoke is bare `curl -fsS` for HTTP 200, which means a page that throws on null `.map()` would still 200 if Next.js renders an error boundary — the smoke is mostly proving the build runs.

**Top-10 highest-risk untested paths** (initial reading; subject to revision in CP-2):

1. `apps/worker/src/orchestrate.ts:runRefresh` — orchestration with 25s timeouts and last-write-wins merge — no test.
2. `apps/worker/src/orchestrate.ts:withAccountDefaults` — silently fills nullables to keep scoring naive; if a future field is added it will emit `undefined` and crash scoring downstream — no test.
3. `apps/web/src/lib/read-model.ts:getDashboardData` — Expand-3 franchise filter + sort — no test.
4. `apps/web/src/lib/read-model.ts:getAllOpportunities` — `-15m / +36m` window logic — no test.
5. `packages/forecast-generator/src/index.ts` — 244 lines of markdown templating — no test.
6. `packages/db/src/index.ts:pruneOldRuns` — FK-clearing + `OFFSET 12` — no test.
7. `packages/scoring/src/index.ts:diffAccount/diffOpportunity` — JSON.stringify-based diff (will produce false positives on object-key reordering) — partial test only.
8. `apps/web/src/components/AccountsTable.tsx` — multi-bucket sort+filter, ~370 lines client-side — no test.
9. `apps/web/src/app/api/refresh/route.ts` — pg_notify race condition not tested.
10. **CI lint job is failing today** (see §8) — there is no test that proves green on `npm run lint`; the human has been ignoring `tsc -b` errors.

---

## 7. Performance baseline (estimated from code; not runtime-measured)

A field run on a Docker stack would be needed for ground-truth; estimates from code:

- **Manager Dashboard `/`** loads via `getDashboardData()`: one query for the latest `refresh_run`, one query for all `account_view` rows, then a JS filter + sort. With 236 mock accounts (`packages/adapters/mock/src/fixtures.ts` is ~32 kB) and Expand-3 filter ~60 accounts, JSONB read+parse should be sub-100ms locally; rendering is server-side and static-ish. **No perf instrumentation in code.** No `Server-Timing` headers, no React Profiler markers, no log on `getDashboardData` duration.
- **`/accounts`** renders the entire list at full DOM size. `AccountsTable` (370 LOC) does a `useMemo` filter + per-bucket render with no virtualization. **At 60 accounts × 14 columns, this is fine; at 236 (full Expand-3 + future mocks) the row sort is O(n log n) on every keystroke. At 600+ this would chug.** No virtualization library is wired today (`react-virtuoso`, `@tanstack/react-virtual` absent from `apps/web/package.json`).
- **`/opportunities`** does the same naive full render with seven `useMemo` filter Sets and a window of ~3 years × ~3 opps/account ≈ ~600 rows worst case for the pilot pod. Borderline.
- **No server-side pagination anywhere.** Every list reads the full snapshot and slices in memory.
- **Worst-case query latency**: `getPerSourceFreshness()` does `LATERAL jsonb_each_text` over `snapshot_account` for the latest run — bounded by account count, not historical refreshes; probably <50ms.
- **Refresh duration**: `Promise.all` of 7 adapters with 25s timeout each; observed durations are logged but not aggregated. Worker `runRefresh` returns `durationMs` but it is not surfaced anywhere except the audit log.

**Bundle size**: not measured, no budget. `next build` runs in CI but `next build --debug` and `@next/bundle-analyzer` are not configured.

---

## 8. Engineering quality / type safety / build state

- **`npm run lint` (= `tsc -b --pretty`) is failing today** with two errors:
  - `packages/adapters/read/salesforce/src/mapper.test.ts:17` — `SAMPLE_ACCOUNT_ROW` missing required `Assigned_CSE__r` and `Customer_Status__c`.
  - `packages/adapters/read/salesforce/src/mapper.test.ts:111` — `SAMPLE_OPP_ROW` missing required `Sales_Engineer__r`.
  - **Implication:** the CI workflow as written would also fail this step (`.github/workflows/ci.yml:38`), unless CI has been masking it. This must be confirmed with the user — possible the tests were being run on `main` which has different fixtures, but the local working tree fails. **P0 for Phase 1.**
- **`npm run ci:guard` passes.** Read-only invariants intact.
- `noUncheckedIndexedAccess: false` (`tsconfig.base.json:16`) — array `[i]` access produces `T` not `T | undefined`. Several `.test.ts` and component files rely on this. Tightening would surface real crashes (e.g., `closeQuarter.split('-')[0]` in `apps/web/src/app/accounts/page.tsx:42`).
- **No ESLint, no Prettier, no import-order rule, no no-restricted-imports** for `'server-only'`-protected modules from client components. `read-model.ts` correctly imports `'server-only'` (`apps/web/src/lib/read-model.ts:2`) but nothing prevents a future client component from importing it.
- **No structured logger.** Worker uses `console.log` with a hand-rolled tag; `AdapterLogger` interface exists (`canonical/src/index.ts:209-213`) but is implemented as a `console` shim (`orchestrate.ts:150-162`). No request IDs propagated to the web layer.
- **No tracing.** Adapter durations are logged per-line; no aggregation, no histogram, no APM hook.
- **Auth/AuthZ:** none. Anyone with localhost access sees the full dashboard. The README acknowledges this is out of scope for v0 (`README.md:298-300`). Re-flag for §4.8 audit.
- **Secrets:** `.env` is gitignored; `.env.example` is the only checked-in env template. No rotation tooling. `.docker-ca.pem` is gitignored.
- **Error handling discipline:** good in places (`orchestrate.ts` per-adapter try/catch with logger.error), weak in others — `apps/web/src/app/api/refresh/route.ts:8-9` swallows nothing but also surfaces nothing actionable to the UI (`RefreshButton` POSTs and discards the body).
- **Dependency major versions:** Next 14, React 18, jsforce-node, pg 8 — none stale, none at major-version-bump risk.

---

## 9. Accessibility baseline (estimated from code; tooling absent)

No automated a11y check is wired. From a static read of the top 5 routes:

- **`/` Dashboard** (`page.tsx`): semantic `<h1>`, `<h2>` via `Card`, but the three Bucket lists are `<ul>` with no `aria-label`; tile cluster is `<div>` not a `<dl>`. RiskBadge uses background-color-only conveyance ("via fallback" is text). Likely WCAG 1.4.1 (use of color) issue when sentiment uses only color + abbreviation ("Green/Yellow/Red" — the labels save it on this one).
- **`/accounts` AccountsTable**: 370-line client component, `<th>` are clickable buttons (`TableHeader` not yet read in detail) but rows have no `<caption>` or `aria-rowcount`. Bucket-grouping is rendered as multiple `<table>` siblings — fine for screen readers. Checkboxes have no associated `<label>` (`AccountsTable.tsx:218-223` — checkbox without label is a P1 a11y issue). Funnel filter dropdowns (`AccountFilters.tsx`) have `aria-haspopup` and `aria-expanded` ✓ but the listbox role on `<ul>` with `<input type=checkbox>` siblings is wrong (should be `role=menu` or pair `<label>` with each option correctly).
- **`/wow` and `/hygiene`**: simple list rendering. `<table>` in `/hygiene` lacks `<caption>`; column headers use `<th>` ✓.
- **`/admin/refresh`**: ARIA-clean.
- **No focus management on modals** because there are no modals — all UX is plain links and dropdowns.
- **Color contrast**: Tailwind defaults are mostly OK. `text-gray-500` on `bg-gray-50` for the `/admin/refresh` empty-state subtitle is 4.5:1 borderline; `text-amber-700` on `text-amber-50` is fine. Need axe to confirm.

**Blocking for §10 a11y bar** ("zero axe-core critical/serious"): need to add Playwright + axe-core in CI as a separate job. Listed for CP-2.

---

## 10. Reconciling the §2 outcomes against today's surfaces

| §2 outcome | What today's tool does | Gap |
|---|---|---|
| **Earlier churn risk detection** | Cerebro Risk Category passthrough (or fallback heuristic), 6 hygiene rules, WoW diff over `cerebroRiskCategory`/`cseSentiment`/forecast fields | No composite Risk Score with weighted explainable signals (§4.4); engagement-decay, sentiment-age-vs-SLA, sentiment-delta, telemetry/utilization (PBU exists in upsell only), health-score-delta, open-cases, stakeholder-churn, M&A, contract-signals (auto-renew off), dark-account-flag are **either absent or scattered**. No "≥30 days before $-forecast" leading-indicator framing anywhere in code. |
| **Manager efficiency** | `/forecast` generates a markdown weekly update; `/wow` diff; per-CSE hygiene rollup; URL-shareable quarter filter on `/accounts` | No pagination/virtualization (would matter at scale); no save-play workflow (deferred to apps/actions per §12 decision); no Clari-paste CSV; no exec/QBR PDF; no keyboard-first nav (`j/k`, `/`, `e`, `s`, `?`); no per-user persistence of filters/columns; no tiered "first 10 seconds" landing answer. The `/forecast` markdown is close to the §4.7 "Weekly Update" format but missing the "no activity in last 7 days" explicit dark-flag and the Clari roll-up table. |

This becomes the spine of `01_findings.md` (CP-2).

---

## 11. What I almost got wrong

- **Initial assumption**: the prompt's §4.5 "one-click save plays" implied I needed to lift the read-only invariant in Phase 1. The user picked **(c) Hybrid**, which means Phases 1–3 are read-only with handoff artifacts. I would have wasted iterations designing a write-adapter directory tree if I'd assumed (b).
- **Initial assumption**: the README's "73 tests" was current. It's actually 83 — codebase moves faster than its docs. Will not assume any documented number is current.
- **Initial assumption**: tests passing means the build is green. Tests pass on vitest, but `tsc -b` (the `lint` target) **fails today** — vitest ignores tsc errors and runs anyway. I would have shipped a phase-1 PR onto a red main branch.
- **Initial assumption**: `cerebroRiskCategory` source is a Cerebro REST API. There is **no public Cerebro API**; the field is intentionally null for now (per the system memory and README §6 on Cerebro/Glean), and `via fallback` is the **correct UI state**, not a bug. I would have written a P1 finding to "fix Cerebro Risk Category" — that would be wrong.
- **Initial assumption**: Clari is an ingested source. It is not — the tool *generates* a markdown the manager pastes *into* Clari. The §4.7 ask therefore is to **add** Clari-paste CSV export, not to fix a broken Clari import. (Q2 in the kickoff message remains open for CP-3 in case the user expects bidirectional Clari.)
- **Initial assumption**: a "data-quality" panel does not exist. Partially correct — the per-source freshness card on `/admin/refresh` is the closest thing today, but it surfaces "did the adapter run" not "which accounts have stale or missing critical fields ranked by ARR exposure" (§4.2 ask). The latter is greenfield.

---

## 12. Open questions deferred to CP-3 (planning)

1. **Q2 from kickoff** — Is Clari ingested anywhere outside this repo, or strictly an output target? Answer changes whether §4.4 "contract signals" can rely on Clari forecast deltas at all.
2. **Q3 from kickoff** — Are direct Slack/Zoom adapters in scope, or stay through Glean MCP?
3. Is the Salesforce-mapper-test-fixture failure (§8) pre-existing on `main`, or did I find it in an in-flight working tree? Will check at CP-2 with `git log` on `mapper.ts` vs. `mapper.test.ts`.
4. Pilot scope: §2 says "~50–60 accounts per quarter" but `getDashboardData` filters to `franchise === 'Expand 3'` which today returns 236 accounts in mocks. Confirm whether the pilot is "Expand 3 entire book" or "Expand 3 accounts with renewal in current quarter."
5. Do the 7 charge models the prompt mentions (Pricing, Expertise, etc.) map 1:1 to the 7 `cerebroRisks` booleans? Empirically yes (`canonical/src/index.ts:83-91` enumerates utilization/engagement/suite/share/legacyTech/expertise/pricing — 7), but the labels in §4.4 of the prompt ("Health score delta", "Open critical/high cases", "Stakeholder churn", "M&A") do not overlap with these. Confirm at CP-3 which signals join the new Risk Score and which stay separate.

---

## 13. Sign-off ask (CP-1)

I have a sufficient repo map to begin §4 audit (CP-2). Before I do, I'd like to confirm three scope choices that materially affect the audit's prioritization:

1. **Is the failing `tsc` build (§8) a P0 finding for Phase 1, or pre-existing technical debt the user is aware of?** I will treat it as P0 by default unless told otherwise.
2. **Pilot count clarification** — confirm 50–60 vs. 236 accounts is the target for perf/UX work.
3. **Read-only stance reaffirmed** — the audit will recommend "deep links + clipboard exports" wherever the prompt asks for write actions (§4.5 save plays, §4.4 stakeholder ping, §4.7 export to Google Doc / Clari). Confirm that's still the intent of (c).

If silent, I will proceed to CP-2 with these defaults: P0 build fix, target pilot ≈ 60 accounts visible at once with headroom to 236, all save/notify actions = export-and-deep-link only.
