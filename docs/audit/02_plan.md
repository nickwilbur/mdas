# 02 — Phased Plan (CP-3)

**Owner:** Cascade
**Date:** 2026-04-28
**Engagement model:** (c) Hybrid — read-only Phases 1–3; writes deferred to a future `apps/actions` service.
**Constraint:** every change uses real data only. No invented metrics, no dummy seeded values. Where a measurement is needed for a decision, the plan instruments first and decides second.

---

## Sequencing principle

Each phase ends with a **green CI run on `master`** as the exit gate. No phase advances if CI is red. Within a phase, P0s ship first as their own PR (so the rest of the phase can rest on a green base). All work is **additive or refactoring** — no removed features, no behavior regressions.

---

## Phase 1 — Stabilize, Fix P0s, Land High-Value UX (target: 1 working week)

**Exit criteria:**

1. `npm run lint`, `npm test`, `npm run ci:guard` all green on `master`.
2. CI runs on `push` to `master` (not just PRs to `main`).
3. `npm run check` is a one-shot local gate.
4. `apps/web/src/app/error.tsx` exists; pages no longer 500-blank on DB error.
5. `tsconfig.base.json` has `noUncheckedIndexedAccess: true`; all resulting errors fixed.
6. Dashboard `/` answers "what changed and what's next" — Action queue + WoW strip on top, roll-up tiles below.
7. New `/admin/data-quality` page with by-source and by-field staleness ranked by ARR exposure.
8. `<SourceDots />` and `<FreshnessRow />` use shape + color (not color-only).
9. `RefreshButton` shows partial-success and per-source error counts.
10. Forecast generator has a golden-file test.
11. Keyboard hotkeys (`/`, `j/k`, `?`) on `/accounts` and `/opportunities`.
12. Composite Risk Score scaffold lands behind a feature flag — old `getRiskIdentifier` still in use, new `getRiskScore` available for the dashboard's Action queue.

### Phase 1 PR breakdown

| PR | Title | Findings | Files | Effort |
|---|---|---|---|---|
| **PR-A1** | **P0 — Make CI green on master** | F-01 | `packages/adapters/read/salesforce/src/mapper.test.ts`, `.github/workflows/ci.yml`, `package.json` (add `npm run check` alias) | S |
| PR-A2 | P0 — `noUncheckedIndexedAccess`: true + sweep | F-02 | `tsconfig.base.json`, ~10 call sites in `apps/web/**` and tests | M |
| PR-A3 | P0 — Error boundary + safe-read | F-03 | new `apps/web/src/app/error.tsx`, `apps/web/src/lib/read-model.ts` (wrap throws), small UI in pages | S |
| PR-A4 | F-13 — Read `/api/refresh/[jobId]`, widen to include partial-success payload | F-08, F-13 | `apps/web/src/app/api/refresh/[jobId]/route.ts`, `apps/web/src/components/RefreshButton.tsx` | S |
| PR-A5 | F-07, F-10 — A11y pass on `<SourceDots />`, `<FreshnessRow />`, table checkboxes | F-07, F-10 | `apps/web/src/components/ui.tsx`, `apps/web/src/components/AccountsTable.tsx` | S |
| PR-A6 | F-12 — Forecast generator golden-file test | F-12 | new `packages/forecast-generator/src/index.test.ts` | S |
| PR-A7 | F-11 — Keyboard hotkeys | F-11 | new `apps/web/src/components/useGlobalHotkeys.ts`, wire into `/accounts`, `/opportunities` | S |
| PR-A8 | F-06 — Data-quality page | F-06 | new `apps/web/src/app/admin/data-quality/page.tsx`, extend `read-model.ts` aggregation, new component `<StalenessByARR>` | M |
| PR-A9 | F-04 — Redesign `/` as Action-queue + Movements strip | F-04 | `apps/web/src/app/page.tsx`, new `apps/web/src/components/ActionQueue.tsx`, `<MovementsStrip>` (re-uses `getWoWChangeEvents`) | M |
| PR-A10 | F-05 — Composite Risk Score (scaffold, behind flag) | F-05 | new `packages/scoring/src/risk-score.ts`, tests, opt-in flag in `read-model.ts` | M |

**Order matters:** PR-A1 first, PR-A2 second (foundational), PR-A3 third (test infrastructure for everything after). PR-A4..A8 are independent and parallelizable in any order. PR-A9 depends on PR-A4 and PR-A8 (uses the new partial-success and DQ data on the dashboard). PR-A10 lands last — its gate is "green dashboard tile rendering using risk score."

### Phase 1 measurements to capture (real data, no estimation)

Before/after for each:

- `npm run lint`: pass/fail.
- `npm test`: pass count.
- React Profiler trace of `/accounts` at the actual current account count (whatever localSnapshots seeds — verified at runtime, not assumed).
- `wc -l` of `apps/web/src/components/AccountsTable.tsx` (regression budget: ±50 LOC).
- Server-Timing header on `/` and `/admin/data-quality` (need to add — small Next 14 instrumentation).

---

## Phase 2 — Risk-Score, Telemetry, and Tests (target: second week)

**Exit criteria:**

1. Composite Risk Score ships **as the default** on `/`, `/accounts`, `/accounts/[id]` (flag flipped). Old `RiskBadge` still renders the Cerebro passthrough alongside as a "via cerebro" reference.
2. Per-account, per-signal explainability ("Why is this account at risk score 72?") is one click away on `/accounts/[id]`.
3. Playwright + axe-core CI job catches a11y regressions on `/`, `/accounts`, `/accounts/[id]`, `/opportunities`, `/admin/refresh`, `/admin/data-quality`.
4. Lighthouse CI captures perf budget (initial budget: TTI < 2.5s on dashboard at the actual account count from a docker-compose seeded environment — measured first, set budget at +20%).
5. `pino` (or equivalent) JSON logging in worker; request-id correlation web → worker.
6. Per-account adapter timeout (F-17) and `JSON.stringify` diff fix (F-15).

### Phase 2 PR breakdown

| PR | Title | Findings | Effort |
|---|---|---|---|
| PR-B1 | F-05 (full) — Risk Score with all today-sourced signals + per-signal pill explainer on Drill-In | F-05 | M |
| PR-B2 | F-15 — Replace `JSON.stringify` diff with deep-equal | F-15 | S |
| PR-B3 | F-17 — Per-account adapter timeout + soft-cap | F-17 | M |
| PR-B4 | F-14 — `pino` + request ID propagation | F-14 | M |
| PR-B5 | F-20 (a) — Playwright + axe job | F-20 | M |
| PR-B6 | F-20 (b) — Lighthouse CI with budget | F-20 | S |
| PR-B7 | F-09 — Virtualization (only if Phase 1 measurement showed >300ms render at production-like row counts; otherwise defer to Phase 3) | F-09 | M |

---

## Phase 3 — Polish, Hardening, Backlog Drain (target: third week)

**Exit criteria:**

1. F-16 (prune ordering tiebreaker), F-19 (bundle analyzer + budget), F-21, F-22 closed.
2. `/forecast` updated for §4.7 ask: Confirmed/Most-Likely/Hedge roll-up table, dark-account flag (no activity in last 7 days), Clari-paste CSV export.
3. Exec/QBR mode on `/accounts/[id]`: hide hygiene, hide internal speculation, render print-friendly. Single button "Open in print view."
4. Per-user persistence of `/accounts` filter+sort state (localStorage; no server state, no auth).
5. `/admin/data-quality` adds field-level staleness drill-in.
6. Per-source freshness on `/admin/refresh` shows percentile distribution, not just MAX.

### Phase 3 PR breakdown

| PR | Title | Findings | Effort |
|---|---|---|---|
| PR-C1 | F-16, F-21, F-22, F-18 (audit-only acknowledgment) — small hardening batch | various | S |
| PR-C2 | F-19 — bundle analyzer + budget | F-19 | XS |
| PR-C3 | §4.7 — Forecast Clari-paste CSV + dark-account flag + "no activity in 7d" | (new requirement) | M |
| PR-C4 | §3 — Exec/QBR print mode | (new requirement) | M |
| PR-C5 | §3 — Per-user persistence (localStorage) | (new requirement) | S |

---

## Out of scope for this engagement (logged for §12 follow-ups)

- AuthN/Z (P3). Punt unless tool moves off localhost.
- Real-time updates (WebSockets/SSE). Punt.
- LinkedIn/news/M&A enrichment. Requires source identification first; not under MDAS today.
- Direct Slack/Zoom adapters. Open question Q3 — defer to user.
- Stakeholder-churn signal source (§4.4). Need data source identification.
- `apps/actions` write service. Out of scope per (c) hybrid decision; revisit at end of Phase 3.

---

## Decision log

- **D-1 (CP-3, today):** treat F-01 (CI red) as P0. Land PR-A1 first, separately, before any other work.
- **D-2 (CP-3, today):** F-09 (virtualization) is gated on Phase-1 React Profiler measurement. No optimization without a baseline.
- **D-3 (CP-3, today):** F-05 (Risk Score) ships in two stages — Phase 1 scaffold behind flag, Phase 2 default-on with explainability. Lower regression risk than a one-shot replace.
- **D-4 (CP-3, today):** all UI a11y fixes ride alongside the surface they touch (don't batch them into a "a11y PR" — easier to review with the surface change).
- **D-5 (CP-3, today):** the audit will not introduce ESLint or Prettier in Phase 1. The added churn outweighs the value during this audit. Revisit at Phase 3 if patterns slip.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `noUncheckedIndexedAccess: true` cascades into many files | medium | Sweep in PR-A2 in isolation; no other changes interleaved. |
| F-04 dashboard redesign breaks muscle memory | low | Old roll-up tiles are kept (demoted, not deleted). Action queue is additive. |
| F-05 Risk Score signal weights become a debate | high | Ship Phase 1 with documented weights from the prompt §4.4; treat as v0.1; use feature flag so weight changes don't require re-deploy. |
| F-06 DQ surface exposes how bad freshness really is | (this is the point) | Land alongside a clear "what to do about it" CTA per row. |
| F-08 widening API response is a breaking change | low | Existing callers ignore extra fields; add new shape additively. |
| Phase 1 timeline slips because PR-A2 sweep is wider than expected | medium | Time-box PR-A2 at 4h; if it spreads beyond, narrow the scope to `apps/web/**` only and defer adapter sweeps to Phase 3. |

---

## Phase 1, PR-A1 — implementation contract

This is the next concrete action. Spelling it out before I do it:

1. Append `Assigned_CSE__r: { Name: 'Test CSE Name' }` and `Customer_Status__c: 'Live'` to `SAMPLE_ACCOUNT_ROW` in `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/mapper.test.ts:17`.
2. Append `Sales_Engineer__r: { Name: 'Test SE Name' }` to `SAMPLE_OPP_ROW` at `:111`.
3. Add a test asserting `mapAccount`'s `assignedCSE.name` resolves to the `Assigned_CSE__r.Name` (production-relevant: today the test at `:49` asserts `name === id` because the resolver fallback fires when `__r.Name` is null; the new assertion validates the happy path the mapper was extended for).
4. Add a similar test on `mapOpportunity.salesEngineer.name`.
5. Change `@/Users/nick.wilbur/ai/mdas/.github/workflows/ci.yml:3` from `branches: [main]` to `branches: [master, main]`. (Two-branch list is forwards-compatible if the team renames.)
6. Add a `"check": "npm run ci:guard && npm run lint && npm test"` script to root `package.json`.
7. Run `npm run check` locally; expect green.
8. Commit on master, do not push (per user instruction "do not stage data" → I will not `git add`; I will leave the working tree changes for the user to review and stage themselves).

**Stop conditions for PR-A1:**

- If `noUncheckedIndexedAccess: true` somehow flips during the sweep and breaks more than 5 files: stop, log, escalate before continuing.
- If `npm run check` exposes a different test-time error I didn't see in CP-1's read: stop, log, escalate.
- Otherwise: continue to PR-A2.
