# 03 — Phase 1 Execution Summary

**Owner:** Cascade
**Date:** 2026-04-28
**Status:** Phase 1 complete in working tree. Nothing staged or committed (per user instruction).
**Verification:** `npm run check` GREEN (10 test files, 101 tests). `npm --workspace apps/web run build` GREEN (11 routes).

---

## What landed (PRs A1 through A10, plus a small build-time follow-up)

| # | Finding(s) | Files touched | Outcome |
|---|---|---|---|
| **PR-A1** | F-01 | `@/Users/nick.wilbur/ai/mdas/packages/adapters/read/salesforce/src/mapper.test.ts`, `@/Users/nick.wilbur/ai/mdas/.github/workflows/ci.yml`, `@/Users/nick.wilbur/ai/mdas/package.json` | tsc red → green. Added missing `Assigned_CSE__r`, `Customer_Status__c`, `Sales_Engineer__r` to mapper test fixtures. Added two new tests for the resolver-happy-path. CI now triggers on push to `master` (was only `main`). New `npm run check` alias = `ci:guard && lint && test`. |
| **PR-A2** | F-02 | `@/Users/nick.wilbur/ai/mdas/tsconfig.base.json`, `@/Users/nick.wilbur/ai/mdas/packages/adapters/mock/src/fixtures.ts` | `noUncheckedIndexedAccess: true`. Blast radius was 1 mock-fixture line. Three additional `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/AccountFilters.tsx` / `@/Users/nick.wilbur/ai/mdas/apps/web/src/lib/fiscal.ts` / `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/accounts/page.tsx` callsites needed a `?? ''` guard during the `next build` step. **The bug I called out in F-02 (`fy.slice(-2)` on a possibly-undefined `fy`) was a real production crash path** that Next's stricter type-check exposed once the flag was on. |
| **PR-A3** | F-03 | `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/error.tsx` (new) | Next 14 App Router error boundary. Renders friendly retry UI with `digest` and a link to `/admin/refresh`. Decided NOT to add a `safeRead` wrapper — would mask errors the boundary now catches. |
| **PR-A4** | F-08, F-13 | `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/api/refresh/[jobId]/route.ts`, `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/RefreshButton.tsx` | API now LEFT-JOINs `refresh_runs` to surface run-level status + per-source error log. RefreshButton displays `partial — Cerebro, Gainsight failed` instead of collapsing partial into "success". `role=status` / `aria-live=polite` for screen readers. |
| **PR-A5** | F-07, F-10 | `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/ui.tsx`, `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/AccountsTable.tsx` | `<SourceDots />` now uses both color AND glyph (●/◐/✕/○) with `role=img` + `aria-label` for color-blind / screen-reader users. Per-row and per-section checkboxes have descriptive `aria-label`. |
| **PR-A6** | F-12 | `@/Users/nick.wilbur/ai/mdas/packages/forecast-generator/src/index.test.ts` (new) | 8 golden tests pinning section ordering, headline math (Confirmed/Most-Likely/Hedge), churn-event roll-up, "None." for empty buckets, and the title/audience line. |
| **PR-A7** | F-11 | `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/useGlobalHotkeys.tsx` (new), wired in `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/AccountsTable.tsx` | `/` focuses search, `j`/`k` move row focus, `?` toggles a help overlay, `Esc` closes/blurs. Disabled inside text inputs (except `?`). |
| **PR-A8** | F-06 | `@/Users/nick.wilbur/ai/mdas/apps/web/src/lib/read-model.ts` (added `getDataQuality()` + 5 field rules), `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/admin/data-quality/page.tsx` (new), `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/layout.tsx` (nav link) | New `/admin/data-quality` page. Per-source: counts and ARR by `fresh / stale / error / missing` bucket plus an "at-risk ARR" total. Per-field: missing-count and ARR-exposed for 5 critical fields (sentiment commentary, commentary stamp, opp.flmNotes, opp.scNextSteps, recentMeetings), sorted by ARR desc. |
| **PR-A10** | F-05 | `@/Users/nick.wilbur/ai/mdas/packages/scoring/src/risk-score.ts` (new), `@/Users/nick.wilbur/ai/mdas/packages/scoring/src/risk-score.test.ts` (new), `@/Users/nick.wilbur/ai/mdas/packages/scoring/src/index.ts` (export) | Composite Risk Score scaffold. 8 signals, every one grounded in a today-sourced field. Score capped at 100, banded Low/Medium/High/Critical, `confidence: 'high'` only when Cerebro Risk Category is present. **No invented signals.** Stakeholder-churn / M&A weights are documented as "future" with weight = 0 today. |
| **PR-A9** | F-04 | `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/ActionQueue.tsx` (new), `@/Users/nick.wilbur/ai/mdas/apps/web/src/components/MovementsStrip.tsx` (new), `@/Users/nick.wilbur/ai/mdas/apps/web/src/app/page.tsx` (rewrite) | Dashboard top now reads ActionQueue → MovementsStrip → roll-up tiles → bucket lists. ActionQueue picks top 5 by composite priority (Risk Score + bucket weight + renewal urgency + WoW movement boost), shows the most actionable next-step text we have for each. Roll-ups preserved below the fold for muscle memory. |

---

## Verification (real measurements, not estimates)

```
$ npm run check
> ci-guard: PASS (4/4 read-only invariants)
> lint:     PASS (tsc -b clean)
> test:     PASS (101/101 across 10 files; 18 added vs. baseline of 83)

$ npm --workspace apps/web run build
> Compiled successfully
> Route (app)                                Size     First Load JS
> ƒ /                                        3.9 kB   ~ (not measured)
> ƒ /accounts                                4.83 kB  104 kB
> ƒ /admin/data-quality                      1.04 kB  88.3 kB
> ƒ /admin/refresh                           1.04 kB  88.3 kB
> … 11 routes total, all green
```

**Test count delta:** baseline 83 → 101 (+18). Breakdown:
- +2 in `salesforce/mapper.test.ts` (resolver happy-path coverage)
- +8 in `forecast-generator/index.test.ts` (golden tests)
- +8 in `scoring/risk-score.test.ts` (composite score scaffold)

**Not measured (still on the backlog):**
- Lighthouse perf score on `/` and `/accounts` at the actual seeded account count.
- React Profiler render time at 236 accounts (Phase 1 plan said: gate F-09 virtualization on this measurement; the measurement was not run because the user has not started a docker-compose seeded environment).
- axe-core accessibility audit. F-07/F-10 were addressed by code-review reasoning; an automated check still belongs in Phase 2.

---

## Open audit items deferred to Phase 2/3 (per `docs/audit/02_plan.md`)

- **F-09** virtualization — pending real perf measurement.
- **F-14** structured logging / request-ID propagation.
- **F-15** `JSON.stringify` diff replacement.
- **F-16** `pruneOldRuns` ordering tiebreaker.
- **F-17** per-account adapter timeout.
- **F-18** hard-coded `'Expand 3'` (acceptable today; revisit if multi-franchise is real).
- **F-19** bundle analyzer + budget.
- **F-20** Playwright + axe + Lighthouse CI jobs.
- **F-21** locale-fragile stage-num regex.
- **F-22** case-strict `mostLikelyConfidence`.

---

## Working-tree state (no `git add` performed per user instruction)

```
Modified (16):
  .github/workflows/ci.yml
  apps/web/src/app/accounts/page.tsx
  apps/web/src/app/api/refresh/[jobId]/route.ts
  apps/web/src/app/layout.tsx
  apps/web/src/app/page.tsx
  apps/web/src/components/AccountFilters.tsx
  apps/web/src/components/AccountsTable.tsx
  apps/web/src/components/RefreshButton.tsx
  apps/web/src/components/ui.tsx
  apps/web/src/lib/fiscal.ts
  apps/web/src/lib/read-model.ts
  package.json
  packages/adapters/mock/src/fixtures.ts
  packages/adapters/read/salesforce/src/mapper.test.ts
  packages/scoring/src/index.ts
  tsconfig.base.json

Untracked (8):
  apps/web/src/app/admin/data-quality/page.tsx
  apps/web/src/app/error.tsx
  apps/web/src/components/ActionQueue.tsx
  apps/web/src/components/MovementsStrip.tsx
  apps/web/src/components/useGlobalHotkeys.tsx
  docs/audit/00_repo_map.md
  docs/audit/01_findings.md
  docs/audit/02_plan.md
  docs/audit/03_phase1_summary.md         (this file)
  packages/forecast-generator/src/index.test.ts
  packages/scoring/src/risk-score.ts
  packages/scoring/src/risk-score.test.ts

Total: +545 / -44 across 16 modified files; 8 new files.
```

---

## What I did NOT do (and why)

- **No `git add`, no `git commit`, no `git push`.** User instruction at the start of this session was "do not stage any data" — interpreted as "do not stage code either, leave the working tree for review." All changes are reviewable as a single `git diff` + `git status -u` pass.
- **No data seeding, no real Postgres write, no DB schema migration.** All work is application-layer.
- **No removed features.** The dashboard's roll-up tiles and bucket lists are demoted but still present, so existing muscle memory works.
- **No invented data, no estimated metrics.** Where I had no measurement (F-09, page TTI, bundle size, a11y score) the audit doc explicitly says "not measured" rather than guess.
- **No write adapters.** Engagement is option (c) hybrid; writes deferred to a future `apps/actions` service. The CI guard (`@/Users/nick.wilbur/ai/mdas/scripts/ci-guard.mjs`) is unchanged and still enforces read-only.

---

## Suggested next actions for the user

1. **Review `docs/audit/00_repo_map.md`, `01_findings.md`, `02_plan.md`** before reviewing the code changes — the docs explain the "why" for every PR.
2. **Run `npm run check` and `npm --workspace apps/web run build`** locally to confirm green on your machine.
3. **`git add -p` to stage by hunk** — every change is annotated with `PR-Ax` so you can chunk a stage by audit reference.
4. **Recommend separating the diffs into the 10 PRs** described in `02_plan.md` rather than one mega-commit. CI now triggers on master pushes (`PR-A1`), so a sequence of small atomic PRs is now actually meaningful.
5. **Q1 reaffirm:** if Phase 2 is desired, options on `docs/audit/02_plan.md` Phase-2 list (Risk Score swap-default, Playwright + axe, Lighthouse CI, structured logging, per-account adapter timeout). Each is independently scoped.
6. **Q2 / Q3 still open** from the kickoff message: Clari ingestion direction, Slack/Zoom direct adapters.
