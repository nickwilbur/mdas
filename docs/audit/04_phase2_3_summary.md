# 04 — Phase 2 + Phase 3 Execution Summary

**Owner:** Cascade
**Date:** 2026-04-28
**Status:** Phase 2 (PR-B1..B6) and Phase 3 (PR-C1..C5) shipped on `master`.
**Verification:** `npm run check` GREEN (12 test files, 123 tests). `npm --workspace apps/web run build` GREEN (11 routes).

---

## Phase 2 — Risk-Score, Telemetry, Tests

| # | Title | Findings | Outcome |
|---|---|---|---|
| **PR-B1** | composite Risk Score default-on with per-signal explainer | F-05 | `AccountView.riskScore` enriched at read-time; `<RiskScoreBadge>` renders the 0–100 score + band (with `low conf` pill when Cerebro Risk Category is missing) on `/`, `/accounts`, `/accounts/[id]`. New `<RiskScoreExplainer>` answers "why is this account at risk score N?" on the Drill-In, sourced from the same `RiskScoreSignal[]` the score uses. Cerebro `RiskBadge` preserved alongside per audit decision D-3. |
| **PR-B2** | replace `JSON.stringify` diff with `deepEqual` | F-15 | Stable structural equality at `@/Users/nick.wilbur/ai/mdas/packages/scoring/src/deep-equal.ts`. Three real failure modes closed: object-key reordering false positives, `undefined` vs missing-key collapse, Date / Map / NaN information loss. 10 unit tests including a regression test for the key-reordered-object case that motivated the PR. |
| **PR-B3** | per-adapter timeout, env-configurable | F-17 | `ADAPTER_TIMEOUT_MS` global override + `ADAPTER_TIMEOUT_MS_<UPPER_SNAKE_SOURCE>` per-source override at `@/Users/nick.wilbur/ai/mdas/apps/worker/src/orchestrate.ts`. Timeout error reads `timed out after Nms` (was generic `adapter timeout`) so the partial-success surface from PR-A4 can show `salesforce timed out after 25000ms` directly. Per-account soft-cap deferred until an adapter that iterates accounts exists. |
| **PR-B4** | structured JSON logging + request-id propagation | F-14 | New `@/Users/nick.wilbur/ai/mdas/apps/worker/src/logger.ts` — zero-dep stdout/stderr JSON logger with `child(bindings)`. Worker `runRefresh()` accepts `requestId`; the drain loop child-binds `jobId + requestId` so every adapter line + audit row carries the trace key. `/api/refresh` echoes an `X-Request-Id` response header (jobId by default; honors upstream value). Schema note: `requestId === jobId` to avoid a Phase-2 schema migration. |
| **PR-B5** | Playwright + axe-core a11y CI scaffold | F-20a | `@/Users/nick.wilbur/ai/mdas/playwright.config.ts` chromium-only with cached browsers in CI. `tests/e2e/smoke.spec.ts` (6 routes), `tests/e2e/a11y.spec.ts` (axe WCAG 2 A+AA+best-practice with empty allow-list), `tests/e2e/hotkeys.spec.ts` (PR-A7 regression). New `e2e` job in `.github/workflows/ci.yml` runs against the seeded mock-adapter stack. |
| **PR-B6** | Lighthouse CI scaffold | F-20b | `lighthouserc.json` — 3 routes × 3 runs, desktop preset. Budgets deliberately lenient for v0 (perf=warn 0.70, a11y=error 0.90, CLS=error 0.10) per audit decision D-2 (no optimization without baseline). Reports uploaded to LHCI temporary public storage. New `lighthouse` job parallels `e2e`. |

**Deferred:** PR-B7 (virtualization) is gated on a real React-Profiler measurement at production-like row counts. The audit decision (D-2) was explicit: no optimization without a baseline.

---

## Phase 3 — Polish, Hardening, Backlog Drain

| # | Title | Findings | Outcome |
|---|---|---|---|
| **PR-C1** | small hardening batch | F-16, F-21, F-22 | F-16: `pruneOldRuns` ORDER BY adds `id DESC` tiebreaker so a same-millisecond pair is ordered deterministically and OFFSET-12 can't accidentally land on the most-recent row. F-21: `parseStage` normalizes `,`→`.` before the regex extract so `5,0` (fr_FR locale) yields the same `stageNum` as `5.0`. F-22: new `normalizeMostLikelyConfidence()` at the canonical boundary; SF mapper delegates to it; `it.each` regression tests for `'confirmed'`, `'CONFIRMED'`, `'  Confirmed  '` all → `'Confirmed'`. F-18 (hard-coded `'Expand 3'`) deferred — multi-franchise is not a real ask today. |
| **PR-C2** | bundle analyzer | F-19 | `@next/bundle-analyzer` wired into `apps/web/next.config.mjs`, behind `ANALYZE=1` so a normal `next build` doesn't pay the analyzer overhead. Local usage: `ANALYZE=1 npm --workspace apps/web run build` then `open apps/web/.next/analyze/client.html`. Phase-3 follow-up: capture baseline, set CI assertion. |
| **PR-C3** | Forecast Clari-paste CSV + dark-account flag | §4.7 | `@/Users/nick.wilbur/ai/mdas/packages/forecast-generator/src/clari-csv.ts` exposes `generateClariCsv()` (RFC-4180 quoted CSV with the columns Clari accepts plus MDAS context like Risk Score and Bucket) and `findDarkAccounts()` (no `recentMeetings` / `workshops` / sentiment-commentary signal in the trailing 7 days, sorted by ARR). The markdown headline now surfaces the dark-account count + ARR exposed; an explicit `Dark Accounts` section lists the top 10. `/api/forecast` widens its response to ship markdown + clariCsv + darkAccounts in one round trip. ForecastClient gains `Copy Clari CSV` / `Download .csv` buttons and an amber dark-accounts callout linking each entry to its drill-in. |
| **PR-C4** | exec/QBR print mode on Drill-In | §3 | `?mode=exec` query flag on `/accounts/[id]` hides the MDAS-internal sections (Gainsight Tasks, WoW Changes, Hygiene Issues, raw Source Links) so the page is appropriate to share with a customer or print for a QBR. `@media print` CSS drops the global nav and the back-link toggle row, applies underlined-blue links, removes shadows. Toggle button labeled "Open in exec / print view" / "Exit exec view". Full view stays the default — managers must explicitly opt in so they don't lose ambient context. |
| **PR-C5** | per-user persistence | §3 | `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/useLocalStorage.ts` — SSR-safe React hook. Server returns the initial value so hydration is stable; client populates on mount via `useEffect`. Custom serializer for non-JSON shapes (`setSerializer` for `Set<T>`). Quota-exceeded + JSON-parse errors swallowed with `console.warn`. AccountsTable persists `sortField` / `sortDirection` / `cseFilter` / `search` per browser under versioned keys (`mdas.accounts.v1.*`) so a future shape change can migrate cleanly. `selectedAccounts` deliberately NOT persisted — selections are ephemeral. |

---

## Verification (real measurements, not estimates)

```
$ npm run check
> ci-guard: PASS (4/4 read-only invariants)
> lint:     PASS (tsc -b clean)
> test:     PASS (123/123 across 12 files; +22 vs. Phase-1 baseline of 101)

$ npm --workspace apps/web run build
> Compiled successfully (11 routes, all green)
```

### Test count progression

| Phase | Total | Files |
|---|---|---|
| Pre-engagement | 83 | 7 |
| End of Phase 1 | 101 | 10 |
| End of Phase 2 | 111 | 11 |
| End of Phase 3 | **123** | **12** |

Net: +40 tests across the engagement.

### Net commit history (since `origin/master` start of engagement)

```
26a9dfa  PR-C5: per-user persistence (localStorage) for /accounts state (§3)
3bba432  PR-C4: exec/QBR print mode on Drill-In (§3)
2adc141  PR-C3: Forecast Clari-paste CSV + dark-account flag (§4.7)
bc11288  PR-C2: bundle analyzer behind ANALYZE=1 env flag (F-19)
efd7501  PR-C1: small hardening batch (F-16, F-21, F-22)
d188f56  PR-B6: Lighthouse CI scaffold with lenient v0 budget (F-20b)
3695785  PR-B5: Playwright + axe-core a11y CI scaffold (F-20a)
5139841  PR-B4: structured JSON logging + request-id propagation (F-14)
1f3dd8e  PR-B3: per-adapter timeout, env-configurable (F-17)
8034167  PR-B2: replace JSON.stringify diff with deepEqual (F-15)
8639980  PR-B1: composite Risk Score default-on with per-signal explainer
f4ffa28  PR-A9: dashboard redesign — ActionQueue + MovementsStrip lead the page
6407884  PR-A10: composite Risk Score scaffold (explainable, weighted signals)
6988378  PR-A8: /admin/data-quality page (per-source × ARR + per-field × ARR)
373d496  PR-A7: global keyboard hotkeys + AccountsTable a11y labels
0b3d94f  PR-A5+A6: SourceDots a11y (color+shape+ARIA) + forecast golden tests
aabeee1  PR-A4: surface refresh-run partial-success in API + RefreshButton
cc1a5e4  PR-A3: add Next 14 App Router error boundary
22b9c75  PR-A2: enable noUncheckedIndexedAccess + harden 4 destructure callsites
e5fee14  PR-A1: fix red tsc + CI trigger on master + add npm run check alias
b53eaed  docs(audit): add Phase 1 audit docs (repo map, findings, plan, summary)
```

---

## Findings closure status

| Finding | Phase | Status |
|---|---|---|
| F-01 tsc red, CI broken | 1 | ✅ |
| F-02 noUncheckedIndexedAccess off | 1 | ✅ |
| F-03 no error boundary | 1 | ✅ |
| F-04 dashboard CFO-style snapshot | 1 | ✅ |
| F-05 missing composite Risk Score | 1 + 2 | ✅ (scaffold + default-on) |
| F-06 no data-quality surface | 1 | ✅ |
| F-07 SourceDots color-only | 1 | ✅ |
| F-08 refresh status hides partial | 1 | ✅ |
| F-09 unmeasured perf | — | **deferred** (gated on real measurement) |
| F-10 unlabeled checkboxes | 1 | ✅ |
| F-11 no keyboard hotkeys | 1 | ✅ |
| F-12 forecast generator untested | 1 | ✅ |
| F-13 /api/refresh/[jobId] not exposing run | 1 | ✅ |
| F-14 unstructured logging | 2 | ✅ |
| F-15 JSON.stringify diff | 2 | ✅ |
| F-16 prune ordering tiebreaker | 3 | ✅ |
| F-17 per-account timeout | 2 | ✅ (per-adapter; per-account deferred) |
| F-18 hard-coded `'Expand 3'` | — | **deferred** (acceptable today) |
| F-19 no bundle analyzer | 3 | ✅ (analyzer wired; budget deferred) |
| F-20 no Playwright / axe / Lighthouse | 2 | ✅ |
| F-21 locale-fragile stage-num regex | 3 | ✅ |
| F-22 case-strict `mostLikelyConfidence` | 3 | ✅ |

---

## What I did NOT do (and why)

- **No real-data measurement of perf.** F-09 (virtualization) and the Lighthouse perf budget tightening both want a real React-Profiler / Lighthouse measurement against a production-like row count, which requires a running stack with seeded data. Audit decision D-2 is explicit: no optimization without a baseline.
- **No write adapters.** Read-only enforcement (`scripts/ci-guard.mjs`) is unchanged. The `apps/actions` write service stays out of scope per the (c) hybrid decision.
- **No invented data signals.** Stakeholder-churn and M&A signals in the Risk Score remain documented placeholders with weight 0 because no canonical source provides them.
- **No schema migrations.** `requestId` reuses `jobId` rather than adding a column; cseFilter localStorage layer is purely client-side.
- **No new heavyweight dependencies.** Logger is hand-rolled JSON-on-stdout (no pino) and dark-account / clari-csv use no library — both intentional, both documented.

---

## Open items requiring user decisions

1. **Q2 (Clari)** — input or output only? Determines whether the next phase replaces the Copy-Clari-CSV paste-flow with a direct write.
2. **Q3 (Slack/Zoom adapters)** — direct, or stay through Glean MCP?
3. **Phase 4 sequencing** — likely candidates: tighten Lighthouse budget after a week of LHCI data, virtualize `/accounts` if Profiler measurement justifies it, add a stakeholder-churn signal source if M&A data ingestion is feasible.
