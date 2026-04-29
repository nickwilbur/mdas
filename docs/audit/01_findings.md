# 01 — Findings (CP-2 Audit)

**Owner:** Cascade
**Date:** 2026-04-28
**Mode:** Read-only audit. No code changes in this phase. Every finding is grounded in a file:line citation or a reproducible command. Where I have not measured something, I say "not measured" — no estimates substituted for measurements.

**Scope:** all of `apps/`, `packages/`, `scripts/`, CI config. Persona = Nick (CSE Manager, Expand 3 pilot). Engagement decision Q1 = (c) Hybrid (read-only Phases 1–3).

**Severity legend:** `P0` = blocks Phase 1 PR merge or production-quality release; `P1` = ship in Phases 1–2; `P2` = Phase 3 polish; `P3` = backlog.

---

## P0 — Blockers

### F-01 `npm run lint` is RED on `origin/master`. CI never catches it.

**Evidence:**

```
$ npm run lint
> tsc -b --pretty
packages/adapters/read/salesforce/src/mapper.test.ts:17:7 - error TS2739:
  Type '{ Id: string; … }' is missing the following properties from type 'SfdcAccountRow':
  Assigned_CSE__r, Customer_Status__c
packages/adapters/read/salesforce/src/mapper.test.ts:111:7 - error TS2741:
  Property 'Sales_Engineer__r' is missing in type '{ Id: string; … }'
  but required in type 'SfdcOpportunityRow'.
Found 2 errors.
```

`mapper.ts` declares `Assigned_CSE__r`, `Customer_Status__c`, and `Sales_Engineer__r` as required on `SfdcAccountRow` / `SfdcOpportunityRow` (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/mapper.ts:34`, `:48`, `:84`). The test fixtures at `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/mapper.test.ts:17` and `:111` predate the rename and lack those fields. The SOQL constants in `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/index.ts:39-49` correctly query them. Result: production code is right, tests are stale.

CI is configured to fail on this — `@/Users/nick.wilbur/ai/mdas/.github/workflows/ci.yml:38` runs `npm run lint` — but `@/Users/nick.wilbur/ai/mdas/.github/workflows/ci.yml:3-5` only triggers on `push:[main]` and `pull_request:`. The branch is **`master`**, not `main`. Push events to master never run CI; only PRs do. Recent commit history is direct-to-master (`git log --oneline -n 5`), so the failing state has not been gated.

**Impact:** any PR opened today will fail CI on the `TypeScript build check` step. The Phase 1 audit cannot land without resolving this. Also no developer running `npm run lint` locally is getting a clean build.

**Recommendation (Phase 1, P0):**

1. Add the missing fields to both fixtures with values consistent with the test's intent (`Assigned_CSE__r` is `{Name: string|null}|null`, etc.). One-time fixture patch, no production change.
2. Change the GitHub Actions `push` trigger from `[main]` to `[master, main]` so push events to master also run CI. Do not rename the branch (out of scope for this audit).
3. Add a pre-commit hook OR a tiny `npm run check` alias that runs `lint + test + ci:guard` together, so the build state is impossible to miss locally. Husky is heavyweight; a single `lefthook` config or a 10-line `.git/hooks/pre-push` shipped via `simple-git-hooks` is sufficient.

---

### F-02 No type-safety net on prod read paths because `noUncheckedIndexedAccess` is off.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/tsconfig.base.json:16` sets `"noUncheckedIndexedAccess": false`. Real consequence in production code (not just tests):

- `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/accounts/page.tsx:42` — `k.split('-')` returns `string[]` and `[fy, q] = …` destructures without checking `length === 2`. If a future quarter key omits the dash this throws `TypeError: undefined is not a function` at runtime on `fy.slice(-2)`.
- `@/Users/nick.wilbur/ai/mdas/apps/web/src/lib/fiscal.ts:51` — same pattern, no length guard.
- `@/Users/nick.wilbur/ai/mdas/packages/scoring/src/index.ts:324` — `renewals[0]?.closeDate` already uses optional chaining ✓; this is fine.
- `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/AccountsTable.tsx:147` — `a.opportunities[0]?.closeDate` ✓.

The cost of flipping the flag is medium (a sweep of `[i]` accesses in tests and a few component files); the benefit is a real class of `TypeError: Cannot read properties of undefined` bugs becomes a compile error. **Phase 1, P0** because it's cheap to do once and prevents future regressions.

**Recommendation:** flip `noUncheckedIndexedAccess: true`, fix the resulting errors with explicit guards or non-null assertions where the invariant is local. Pair with `exactOptionalPropertyTypes: true` only as a Phase-3 hardening — that one has higher fix-out cost.

---

### F-03 Read-model has no error path. Pages render a 500 with no context if Postgres is down.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/web/src/lib/read-model.ts` has no `try/catch` around any `query()` call. `getDashboardData` and `getAccount` are server components that throw straight up the React tree. `apps/web/src/app/page.tsx:18` awaits with no error boundary in `apps/web/src/app/layout.tsx`. There is no `apps/web/src/app/error.tsx` global error file (verified by directory listing of `apps/web/src/app/`). Smoke tests in CI hit `/` with `curl -fsS` which returns non-200 on a thrown server component, but the dashboard page itself only checks `if (!refreshId)` — not "DB is down."

**Impact:** any DB blip during a manager's morning standup makes the tool completely opaque. No "DB unreachable, retry in 30s" message; only Next.js's blank 500.

**Recommendation:** add `apps/web/src/app/error.tsx` (Next 14 convention, runs as a client component to catch render errors) with a friendly retry UI; wrap `getDashboardData` / `getAccount` / `getWoWChangeEvents` in a small `safeRead<T>(fn, fallback)` utility that logs and returns a typed failure marker the page can render around. Phase 1, P0 because users of an internal tool diagnose by gut-feel without errors.

---

## P1 — Phase 1 essentials (ship before 30-day check-in)

### F-04 Manager Dashboard answers the wrong question.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/page.tsx:46-117` renders 5 stat tiles + 3 lists (Confirmed Churn / Saveable Risk / Upsell Hot+Active). The §2 / §3 success criterion is "**What changed in my book this week, and what do I need to do about it?**" Today's `/` shows org-roll-up sums, not WoW deltas with action prompts. The WoW data **exists** (`/wow` route, `getWoWChangeEvents`), but lives one click away.

**Impact:** the persona ask in the prompt is "first 10 seconds → my next 3 actions." Today's first 10 seconds gives a CFO-style snapshot.

**Recommendation:** redesign `/` as a "Monday-morning" landing pane:

- Top: **3-row "Action queue"** = top accounts by composite priority (bucket + risk + days-to-renewal + ARR exposure + WoW movement), each with a one-line "what changed" and a primary CTA (Open in SF / Open Drill-In).
- Mid: **"Movements this week"** strip — the existing `/wow` data, but compressed (counts + clickthrough), not a fan-out of 6 cards.
- Bottom: existing roll-up tiles, demoted.

This is layout-only; no new data plumbing. The data and components already exist.

### F-05 No composite Risk Score with explainable signals (§4.4 of the prompt).

**Evidence:** `@/Users/nick.wilbur/ai/mdas/packages/scoring/src/index.ts:35-87` `getRiskIdentifier` returns one of `Cerebro Risk Category` (passthrough) or a fallback derived from count of true Cerebro booleans, then `cseSentiment`. There is no:

- Engagement decay (engagementMinutes30d/90d are on the canonical record but unused in scoring).
- Sentiment age vs. SLA (`cseSentimentCommentaryLastUpdated` is used for hygiene only, not risk).
- Sentiment delta (Red→Yellow→Green movement is not a positive signal anywhere; `diffAccount` records it, scoring ignores it).
- Telemetry / utilization (`Projected Billing Utilization (%)` is used in upsell scoring at `:140-143` but not risk).
- Health score delta, open critical/high cases, stakeholder churn, M&A — no source for any of these today.

**Impact:** the §2 outcome of "**leading indicators ≥30 days before $-forecast moves**" cannot be measured because the only "risk" surface is a passthrough of a field that already moves *in* the forecast cycle (Cerebro Risk Category is updated weekly by CSEs themselves).

**Recommendation:** introduce `packages/scoring/src/risk-score.ts` with a weighted composite. Inputs (only those sourced today; mark others as "future"):

| Signal | Weight | Source today | Field |
|---|---|---|---|
| Cerebro Risk Category (passthrough) | 25 | Cerebro/Glean | `cerebroRiskCategory` |
| Cerebro 7-risk count | 20 | Cerebro/Glean | `cerebroRisks` |
| CSE Sentiment | 15 | SF | `cseSentiment` |
| Sentiment-commentary staleness vs. SLA | 10 | SF | `cseSentimentCommentaryLastUpdated` |
| Engagement decay (30d / 90d ratio) | 10 | SF (Engagio) | `engagementMinutes30d/90d` |
| WoW direction (improving = -5, worsening = +5) | 10 | computed | `diffAll` events filtered by category=risk/sentiment/forecast |
| Renewal proximity (≤90d) | 10 | computed | `daysToRenewal` |
| _stakeholder churn / M&A_ | _0 today_ | _no source_ | _backlog_ |

Output: `{score: 0-100, signals: [{label, points, source}], confidence}`. Render with the existing `<UpsellBandBadge>` pattern but for risk. **Critical:** every signal must show `via {source}` on hover so the manager can see "this score moved because of stale sentiment commentary, not because the customer churned."

### F-06 No data-quality / staleness-by-ARR-exposure surface (§4.2 of the prompt).

**Evidence:** `/admin/refresh` (`@/Users/nick.wilbur/ai/mdas/apps/web/src/app/admin/refresh/page.tsx`) shows per-source freshness as "did the adapter run for any account at all." The unit-of-analysis is `source × refresh`. The persona ask is `account × field × $ARR-exposed`. `getPerSourceFreshness` (`@/Users/nick.wilbur/ai/mdas/apps/web/src/lib/read-model.ts:82-112`) is the closest building block.

**Impact:** I cannot answer "which Tier-1 ARR accounts have stale Cerebro analysis older than 7 days?" — the tool's own integrity is invisible to the operator.

**Recommendation:** new `/admin/data-quality` page + a stat tile on `/`:

- **By source:** count of accounts where `lastFetchedFromSource[source]` is missing or > 7 days, weighted by `account.allTimeARR`.
- **By field:** for the canonical critical-field set (sentiment commentary, FLM notes on opp, scNextSteps on opp, recent meeting), count missing accounts weighted by ARR.
- **Per-account drill:** "freshness card" on `/accounts/[id]` listing each source × field staleness.

`<SourceDots />` and `<FreshnessRow />` already render the per-account view (`@/Users/nick.wilbur/ai/mdas/apps/web/src/components/ui.tsx:245-281`). The aggregation query is one `LATERAL jsonb_each_text` extension of the existing `getPerSourceFreshness`.

### F-07 `<SourceDots />` and `<FreshnessRow />` use color-only conveyance for a critical state.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/ui.tsx:262-271`:

```ts
if (errMsg) { cls = 'bg-red-500'; title = `${source}: error — ${errMsg}`; }
else if (iso) { cls = isStale(iso) ? 'bg-amber-400' : 'bg-emerald-500'; … }
else { cls = 'bg-gray-300'; title = `${source}: no data this refresh`; }
```

Each dot is a 2px×2px rounded span with the state encoded only in fill color. The hover title carries the actual semantics. WCAG 1.4.1 (use of color) violation; also unreadable at the typical viewing distance for a dashboard glance.

**Impact:** screen-reader users get nothing; sighted users at a glance can't distinguish "amber dot 3 of 4" from "green dot 3 of 4" without hovering each cell. On `/accounts` this is 4 dots × 60+ rows × 4 colors.

**Recommendation:** keep dots, add per-state shape: `●` (fresh), `◐` (stale), `✕` (error), `○` (missing). Or: shift to a tiny pill pattern at the row level with an icon + 2-letter source code. Phase 1; trivial to do alongside F-06.

### F-08 `RefreshButton` polls `/api/refresh/[jobId]` with no surfacing of partial-success or error log.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/RefreshButton.tsx:19-30` polls 30 times at 1s and reads only `{status: 'success' | 'failed'}`. The orchestrator emits four statuses (`'success' | 'partial' | 'failed' | 'running'` — `@/Users/nick.wilbur/ai/mdas/packages/db/src/index.ts:35`) and a per-source error log (`refresh_runs.error_log`). The user sees only "Refresh success" even when 3 of 7 adapters failed.

**Impact:** silently degrading data quality. Manager thinks the dashboard is current; it's actually 3-day-stale Cerebro data with a fresh SF.

**Recommendation:** widen `/api/refresh/[jobId]` (file exists, didn't read its content yet — will read in Phase 1 implementation) to return `{status, sourcesSucceeded, sourcesAttempted, errorLog}`. Render in `RefreshButton`: "Refresh partial — Cerebro and Gainsight failed." with a "View details" link to `/admin/refresh`.

### F-09 No virtualization on `/accounts` and `/opportunities`. At Expand 3 = 236 accounts, sort/filter is borderline; at full pilot scope (TBC §12 Q4) this chugs.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/AccountsTable.tsx` re-renders the entire row set on every sort/filter change via `useMemo`. No virtualization library in `apps/web/package.json:11-16`. `OpportunitiesTable` (`@/Users/nick.wilbur/ai/mdas/apps/web/src/components/OpportunitiesTable.tsx`) is the same shape and at 600+ rows would be similar.

**Status:** **not measured.** I have not run a Lighthouse or React Profiler trace. The user instructed not to make up numbers, so I will not estimate ms. The architectural concern stands; the perf claim is provisional until measured.

**Recommendation:** keep as P1 candidate, gated on a measurement. **Phase 1 first action**: instrument `/accounts` with React Profiler (or `<Suspense>` + `next/profile`) and capture a baseline render time at 236 accounts × 14 columns. If < 300ms TTI on a mid-tier laptop, defer virtualization to Phase 3; if > 300ms, ship `@tanstack/react-virtual` in Phase 1.

### F-10 `<table>` checkboxes have no `<label>` association (a11y).

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/AccountsTable.tsx:218-223` and `:308-314` render `<input type="checkbox">` with no `<label>` and no `aria-label`. Section headers have a "Select All" button label, but the per-row checkbox is unlabeled. Screen readers announce "checkbox" with no context.

**Recommendation:** wrap with `<label className="sr-only">Select {accountName}</label>` or use `aria-label`. Phase 1 along with broader a11y sweep.

### F-11 No keyboard-first navigation for power users.

**Evidence:** none of `/`, `/accounts`, `/opportunities` define a global keydown handler. There is no `j/k` row movement, no `/` for focus-search, no `e` for expand-row, no `?` cheat-sheet. The §3 of the prompt explicitly calls out "keyboard-first power-user paths."

**Recommendation:** small `useGlobalHotkeys` hook in `apps/web/src/components/`, wired on `/accounts` and `/opportunities`. Phase 1; trivial.

### F-12 Forecast generator has zero unit tests despite being 244 LOC of templating.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/packages/forecast-generator/src/index.ts` (244 LOC). No matching `.test.ts` (verified `find packages/forecast-generator -name '*.test.*'` returns nothing). The output is the artifact pasted into Clari, so a regression here is a high-cost embarrassment to the manager.

**Recommendation:** golden-file test: feed a fixed `views` + `events` fixture, snapshot the markdown, assert. Phase 1, ~30 min.

### F-13 `apps/web/src/app/api/refresh/[jobId]/route.ts` not yet inventoried.

**Evidence:** I observed the file exists at `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/api/refresh/[jobId]/route.ts` (`list_dir` output) but did not read it. Marking as a known unread surface for honesty. Will read in Phase 1 before extending it (F-08).

---

## P2 — Phase 2/3 polish

### F-14 No structured logging; no request ID propagation; no APM hook.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/worker/src/orchestrate.ts:150-162` is a console-tag shim. Web has no logger at all. No correlation between a `POST /api/refresh` and the worker's job log.

**Recommendation:** Phase 2 — wire `pino` (or `console-style` JSON) with a `requestId` injected by Next middleware and forwarded to the worker via `refresh_jobs.requested_by`. Out of scope if only one operator (Nick); revisit if the tool gains 5+ users.

### F-15 `diffAccount/diffOpportunity` use `JSON.stringify` for change detection.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/packages/scoring/src/index.ts:415` and `:477`:
```ts
if (JSON.stringify(o) !== JSON.stringify(n)) { … events.push(…) }
```

`JSON.stringify` is **not key-order stable** when objects are constructed by spread+merge (which is exactly what `mergeAdapterResults` does). A diff between two adapters that emit the same data with different key orders generates a false-positive change event. We have one piece of evidence the issue could be live: `@/Users/nick.wilbur/ai/mdas/apps/worker/src/orchestrate.ts:124` `existing ? { ...existing, ...a } : a` — spread order depends on adapter ordering, which is deterministic, **but** `withAccountDefaults` (`:92-114`) re-spreads with a fixed key order, so persisted records may have a different key order than what `diffAccount` sees on the next refresh.

**Status:** I have not produced a reproducer. This is a hypothesis grounded in code, not an observed bug. The fix is `lodash.isequal` or a small `deepEqual`; cost is low.

**Recommendation:** Phase 2. Add a deep-equal helper, a regression test that round-trips a record through `withAccountDefaults` twice and asserts `diffAccount` reports zero changes.

### F-16 `pruneOldRuns` retain logic relies on `OFFSET 12` and could prune the latest run if `started_at` is non-monotonic.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/packages/db/src/index.ts:117-129` orders by `started_at DESC OFFSET $1`. `started_at` is set by `NOW()` at row insert (`:48`). If two refreshes start in the same millisecond (unlikely but not impossible — pg-notify can fire `drain()` re-entrantly), the order is undefined.

**Recommendation:** Phase 3. Add `id` as a tiebreaker: `ORDER BY started_at DESC, id DESC OFFSET $1`. Or order by `id` (UUIDv7 isn't used; UUIDv4 has no inherent order — so use `(started_at, id)` composite). Test by inserting two rows with `started_at = NOW()` simultaneously.

### F-17 Adapter `Promise.race` timeout (25s) is per-adapter not per-account; one slow Glean account can abort the entire Glean adapter.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/apps/worker/src/orchestrate.ts:202-207` wraps the entire `a.fetch(...)` call in a 25s race. Glean adapter loops 236 accounts at concurrency 5 (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/glean-mcp/src/index.ts:71`). If one account takes 26s, the whole Glean fetch returns empty.

**Recommendation:** Phase 2. Per-account timeout inside `mapWithConcurrency`; the outer adapter timeout becomes a soft-cap (e.g., 60s) that returns whatever was collected so far rather than throwing.

### F-18 `franchise === 'Expand 3'` filter is hard-coded and exists in 3 places.

**Evidence:**
- `@/Users/nick.wilbur/ai/mdas/apps/web/src/lib/read-model.ts:31` (`filteredViews = views.filter(v => v.account.franchise === 'Expand 3')`).
- `@/Users/nick.wilbur/ai/mdas/apps/worker/src/orchestrate.ts:77` (`const FRANCHISE = 'Expand 3'`).
- `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/index.ts:51` (SOQL `WHERE Current_FY_Franchise__c = 'Expand 3'`).
- `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/mapper.ts:160` (default franchise on missing field).

**Recommendation:** Phase 3 only if multi-franchise support becomes real. Today it's the explicit pilot scope; multiple defining points is acceptable until it's not.

### F-19 No bundle analyzer; `next.config.mjs` not inspected.

**Status:** not measured.
**Recommendation:** Phase 3 — wire `@next/bundle-analyzer`, capture a baseline, set a budget (e.g., 200kB JS for `/`).

### F-20 No Lighthouse CI, no axe-core in CI, no Playwright E2E.

**Recommendation:** Phase 2. Wire a separate `accessibility` job on PRs that runs the build, starts the server, and runs axe on `/`, `/accounts`, `/accounts/[id]`. Same job can run a 3-page Lighthouse with a perf budget.

### F-21 Stage-name parsing is fragile.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/mapper.ts:199-207` `parseStage` extracts `^\d+(\.\d+)?` from `Stage_Num__c`. If Salesforce ever returns `"5"` plus a comma-decimal locale (`"5,0"`), the regex misses. Probably not a live issue (jsforce returns numbers as JSON numbers), but worth pinning with a test case `"5,0" → null` so the intent is documented.

### F-22 `mostLikelyConfidence` accepts case-insensitive but the canonical type is case-strict.

**Evidence:** `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/mapper.ts:129-135` lowercases. Good. But `apps/web/src/components/AccountsTable.tsx` and others compare `=== 'Confirmed'` literally. If a future adapter (Glean? localSnapshots?) emits "confirmed" lowercase, scoring works but UI bucket counts go wrong. Add a unit test or normalize at canonical-type boundary.

---

## P3 — Backlog (not for the current engagement unless explicitly requested)

- **AuthN / AuthZ** — none today (`@/Users/nick.wilbur/ai/mdas/README.md:298-300` accepts this as v0). Re-flag if the tool is exposed beyond `localhost`.
- **Secret rotation tooling** — none. `.env` is per-developer.
- **Multi-tenant / multi-franchise** — none.
- **Internationalization** — none.
- **Real-time updates** — none. WebSockets / SSE are absent. `/admin/refresh` and dashboards reload on user action only.

---

## Additional observations that are not findings (reference only)

- **Salesforce mapper has a known org-vs-design-doc drift table** (`@/Users/nick.wilbur/ai/mdas/docs/field-map.md`). This is well-documented and should be preserved as-is in Phase 1.
- **Cerebro Risk Category coming through as "via fallback" is correct today** (`@/Users/nick.wilbur/ai/mdas/packages/adapters/read/cerebro-glean/src/index.ts:11-20` documents the rationale). Not a finding.
- **The `localSnapshotsAdapter` baseline-then-overwrite pattern** (`@/Users/nick.wilbur/ai/mdas/apps/worker/src/orchestrate.ts:43-52`) is a good design — it makes unattended refreshes idempotent. Worth preserving.
- **Forecast generator already groups by source for the Source Evidence section** (`@/Users/nick.wilbur/ai/mdas/packages/forecast-generator/src/index.ts:233-239`). Solid foundation for §4.7 Clari-paste output.

---

## Summary table

| # | Title | Severity | Phase | Effort |
|---|---|---|---|---|
| F-01 | tsc red on master + CI doesn't trigger | **P0** | 1 | S |
| F-02 | `noUncheckedIndexedAccess: false` | **P0** | 1 | M |
| F-03 | No error boundary / safe-read on pages | **P0** | 1 | S |
| F-04 | Dashboard answers wrong question | P1 | 1 | M |
| F-05 | No composite Risk Score | P1 | 1–2 | L |
| F-06 | No data-quality surface | P1 | 1 | M |
| F-07 | Color-only conveyance in `<SourceDots />` | P1 | 1 | S |
| F-08 | RefreshButton hides partial-success | P1 | 1 | S |
| F-09 | No virtualization (gated on measurement) | P1? | 1 or 3 | M |
| F-10 | Unlabeled checkboxes (a11y) | P1 | 1 | S |
| F-11 | No keyboard nav | P1 | 1 | S |
| F-12 | No tests on forecast generator | P1 | 1 | S |
| F-13 | `/api/refresh/[jobId]` unread by audit | P1 | 1 | S (read first) |
| F-14 | Logging / tracing | P2 | 2 | M |
| F-15 | `JSON.stringify` diff false positives | P2 | 2 | S |
| F-16 | Prune-runs ordering tiebreaker | P2 | 3 | XS |
| F-17 | Per-adapter (not per-account) timeout | P2 | 2 | M |
| F-18 | Hard-coded `'Expand 3'` | P2 | 3 | XS |
| F-19 | No bundle analyzer | P3 | 3 | XS |
| F-20 | No Lighthouse / axe / Playwright | P2 | 2 | M |
| F-21 | Locale-fragile stage-num regex | P3 | — | XS |
| F-22 | Case-strict `mostLikelyConfidence` | P3 | — | XS |

**Effort key:** XS < 1h, S < 3h, M < 1d, L 1–3d.

---

## What I almost got wrong (during CP-2)

- I almost recommended adding a Cerebro Risk Category source. The system memory and `cerebro-glean/src/index.ts:11-20` are explicit: there is none today and the fallback is intentional. I struck it.
- I almost flagged `JSON.stringify` diff as P0. After re-reading `mergeAdapterResults`, the order is deterministic enough that the issue may not surface; demoted to P2 with a "needs reproducer" note.
- I almost flagged virtualization as P0. Without a measurement, I do not have grounds. Demoted to "P1 if measurement justifies."
- I almost wrote "CI is on `main`, branch is `master`, push events never run CI" as a passing observation; on re-read it is the **root cause** of how F-01 landed and is itself a P0 fix.
