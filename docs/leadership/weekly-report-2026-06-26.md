# Existing MDAS Weekly Leadership Report

**Reporting period:** June 20–26, 2026  
**Prepared for:** CSE Leadership / SVP Organization  
**Prepared by:** Staff Engineer + CSE Manager partnership

---

# Page 1 — Overall Dashboard of Health

## Executive Summary

- **Material change:** Seven commits landed on `master` (Jun 22–25), headlined by Expand 3 **account plan generator + renewal workbench** (`3eb7300`), **CTA-to-renewal-opportunity linking with progress tracking** (`39ca46f`, `cd2ff20`), **refresh performance work** (4 commits Jun 24), and **Clari-aligned forecast KPIs + key-activities coverage** (`ce4de89`). Uncommitted work in progress improves CTA generation job polling/UI (`CTABoard.tsx`, `cta-generation-job-watch.ts`).
- **Portfolio shift (6–8Q):** `/renewals` and `/renewal-analysis` now use an 8-quarter **prospective bucket** (current + next 7) per `docs/engineering/renewal-metrics.md`. CTA engine scopes **FY27+FY28 renewals** with an **8-quarter renewal window** (`docs/engineering/cta-framework.md`). This is structural progress toward forward portfolio management—not yet proven as operational habit.
- **ATR retention:** MDAS surfaces renewal risk, GRR, churn/downsell, and ATR-at-risk in renewal dashboards and CTAs. **No measured ATR retention rate or week-over-week retention delta** is available in the workspace. Renewal metric validation checklist items remain **unchecked** (`docs/engineering/renewal-metrics.md`).
- **Visibility gains:** Jun 25 CTA scan produced **31 CTAs** tied to renewal opps with **~$3.7M open ATR at risk** (`expand3_cta_scan_2026-06-25.md`, `expand3_cta_log.jsonl`). Forecast generator now aligns KPIs with Clari and adds key-activities coverage (`ce4de89`). Account plans and Cerebro Engage intelligence are on account pages (feature-flagged).
- **Leadership attention:** **GitHub CI is failing on `master`** (npm peer-dependency conflict: `vitest@1.6.1` vs `@vitest/coverage-v8@4.1.6`; run `28193718579`). Local tests pass (**763/763**), but remote merge/deploy confidence is degraded.
- **Posture:** **Yellow — at risk on delivery gates, progressing on portfolio tooling.** Capability is advancing faster than operational adoption and CI reliability.

## Overall Health Dashboard

| Area | Status | Signal | Leadership Interpretation |
| ----------------------------------- | -------------------- | ----------------------------- | ------------------------------ |
| Overall MDAS Health | **Yellow** | 763 local tests pass; `master` CI failed Jun 25 on `npm ci` | Tooling works locally; production merge pipeline is not green |
| Strategic Alignment to CSE Goals | **Yellow** | 8Q prospective views, CTA engine, account plans shipped this week | Architecture supports proactive portfolio management; adoption metrics not evidenced |
| ATR Retention Support | **Yellow** | Renewal scorecard/workbench + CTA ATR-at-risk fields live | Surfaces risk; **no retention outcome measurement** vs 10% board goal |
| Expand 3 Portfolio Visibility | **Green** | 8-quarter prospective selector; renewal pipeline workbench; account plan generator | Leadership can see forward book by quarter—if managers use `/renewals` |
| Health Signal Usage | **Yellow** | Cerebro, SFDC sentiment, Engagio, Glean combined in scoring + CTAs | Signals are ingested; systematic manager workflow not quantified |
| Renewal Risk Prioritization | **Green** | 31 CTAs ranked by `priority_score`; plays linked to renewal opps | Highest-value risks are named and deduped; **26 still open** |
| Executive Engagement Readiness | **Yellow** | `no_strategic_engagement` play type exists; exec print mode on drill-in (`PR-C4`) | Triggers exist in code; **no exec-engagement SLA or trigger log** this week |
| Account Activity Visibility | **Green** | Dark-account detection, Slack mapping, Glean enrichment, key activities in forecast | Activity gaps are surfaced; **3/31 CTAs marked `team_aware`** |
| AI Adoption / Enablement | **Yellow** | Glean Adaptive chat in forecast (health snapshot, close-gap plans); v2 CTA reasoning workflow doc | AI assists generation; **no CSE hands-on adoption metrics** |
| Engineering Delivery Health | **Yellow** | 7 commits; active perf + feature delivery | Velocity is high; **CI red** undermines confidence |
| Operational / Supportability Health | **Yellow** | Refresh perf improved (coordinated Glean loop); structured JSON logging exists | Refresh is faster; dependency conflict and unchecked SFDC validation remain |

## Leadership Attention Needed

| Item | Why It Matters | Ask / Decision Needed | Owner | Needed By |
| ---- | -------------- | --------------------- | ----- | --------- |
| CI failure on `master` | Latest push (`ce4de89`) did not pass CI; e2e/lighthouse skipped | Approve fix for `vitest` / `@vitest/coverage-v8` peer conflict; restore green `master` | Engineering | Next business day |
| CTA closure rate | 26/31 CTAs open; 5 marked `done` in log | Confirm manager review cadence for open CTAs in `#expand3-risk-signals` | CSE Manager | Weekly standup |
| Renewal metric validation | All reconciliation checklist items unchecked in docs | Sponsor 2-hour SFDC/Clari spot-check for one fiscal quarter | CSE Manager + Ops | Next 2 weeks |

## Strategic Posture

| Field | Value |
|-------|-------|
| **Strategic posture** | Proactive Portfolio Enablement (transitioning from Quarterly Execution) |
| **Overall status** | **Yellow** |
| **Confidence** | **Medium** |
| **Primary leadership attention needed** | **Decision** (restore CI) + **Alignment** (CTA follow-through cadence) |
| **Staff Engineer assessment** | MDAS is building the right 6–8 quarter instrumentation—renewal workbench, account plans, and CTA-to-renewal linkage—but evidence still points to quarterly churn-response (31 CTAs, mostly dark/engagement plays) rather than steady portfolio steering, and CI failure blocks confident delivery. |

<div style="page-break-after: always;"></div>

# Page 2 — Details to Dig Into

## Strategic Alignment to CSE Goals

| CSE Priority | Weekly Progress | Evidence | Retention / Portfolio Impact | Gap or Risk |
| ------------ | --------------- | -------- | ---------------------------- | ----------- |
| 1. Manage Expand 3 portfolio 6–8 quarters out | **Progress** | 8Q prospective bucket on `/renewals`, `/renewal-analysis`; CTA `renewalWindowQuarters: 8` | Enables forward-quarter triage vs current-quarter firefighting | No usage/adoption metrics; managers may still default to current-quarter views |
| 2. Improve ATR retention by 10% | **Partial** | Renewal GRR/churn/downsell metrics defined; CTA `atr_at_risk_usd` on all 31 plays | Surfaces dollars at stake (~$3.7M open ATR in CTA log) | **No board-level retention rate or trend** in repo; validation checklist unchecked |
| 3. Use health signals more systematically | **Progress** | Cerebro REST + Glean enrichment; composite `riskScore`; CTA `source_signals` array | Multi-source signals drive CTA priority and renewal assessment cells | Signal freshness varies; Cerebro Risk Category still has fallback path per README |
| 4. Prioritize highest-value renewal risks | **Progress** | Jun 25 scan: 31 CTAs, priority scores 46–101; top plays include Antylia ($47K), Traxxall ($19.5K), Rimini ($291K) | Named, ranked, renewal-opp-linked asks | 84% CTAs still open; closure workflow not automated |
| 5. Escalate executive engagement earlier | **Limited** | `no_strategic_engagement` play in CTA framework; exec/QBR print mode on drill-in | Code supports exec-ready views | **No direct evidence** of exec escalations triggered or completed this week |
| 6. Increase visibility into account activity | **Progress** | Dark-account detection (weighted signals); Slack channel mapping; key-activities in forecast (`ce4de89`) | Surfaces disengaged accounts before renewal crunch | `team_aware: true` on only **3/31** CTAs—most risks not yet acknowledged in-channel |
| 7. Coach team toward strategic customer engagements | **Partial** | `/hygiene` coaching prompts; account plan generator with evidence-first collectors | Supports coaching on hygiene and account planning | **No direct evidence** of manager coaching sessions driven by MDAS this week |
| 8. Accelerate AI adoption through hands-on enablement | **Partial** | Glean Adaptive chat in forecast generation; v2 CTA reasoning workflow (`.windsurf/workflows/expand3-cta-generator.md`) | AI assists narrative and CTA drafting | Enablement is tool-side; **no CSE usage metrics** |

## Outcomes Delivered This Week

| Outcome | Customer / CSE Impact | Link to ATR Retention or Portfolio Management | Evidence | Follow-up |
| ------- | --------------------- | --------------------------------------------- | -------- | --------- |
| Expand 3 account plan generator + renewal workbench | Managers get evidence-first account plans and pipeline/close views across 8 prospective quarters | Forward portfolio management; renewal triage | Commit `3eb7300`; `packages/account-plan-engine/` | Enable feature flags in prod; pilot with 3 accounts |
| CTA plays linked to renewal opportunities | Every CTA names a renewal opp URL and ATR-at-risk | Prioritizes saveable renewal dollars | Commits `39ca46f`, `cd2ff20`; `expand3_cta_scan_2026-06-25.md` | Drive closure on 26 open CTAs |
| Refresh performance (Glean/Cerebro coordination) | Faster snapshot refresh → fresher health signals | Timelier risk detection | Commits `650bff0`–`92296dc` | Measure refresh duration in ops (not instrumented in repo) |
| Clari-aligned forecast KPIs + key activities | Weekly leadership script matches Clari churn-call template | Retention narrative aligned to board forecast | Commit `ce4de89`; `packages/forecast-generator/` | Validate one quarter against Clari manually |
| Jun 25 full CTA scan | 31 renewal-risk plays generated for FY27+FY28 scope | $3.7M open ATR flagged for manager action | `expand3_cta_scan_2026-06-25.md` | Post/review in `#expand3-risk-signals`; track `done` vs `open` |

## Key Work in Progress

| Workstream | Current State | Expected Impact | Risk / Dependency | Next Milestone |
| ---------- | ------------- | --------------- | ----------------- | -------------- |
| CTA generation job UX | Uncommitted: progress panel, job polling (`CTABoard.tsx`, `cta-generation-job-watch.ts`) | Managers see scan progress; fewer abandoned runs | Not yet merged | Merge + verify on `/ctas` |
| CI dependency fix | `master` CI red on `npm ci` peer conflict | Restores merge confidence | Blocks PR merges | Align `vitest` and `@vitest/coverage-v8` versions |
| Account plan feature flags | Gated by `isExpand3AccountPlanEnabled()` | Strategic account planning at scale | Requires explicit enablement | Enable for pilot CSEs |
| CTA follow-through automation | `follow_through.auto_check_query` defined; `last_checked_at` mostly null | Automated activity verification | Glean query execution not evidenced | Implement check-back runner |
| SFDC validation | Renewal metrics checklist all `[ ]` | Confidence in GRR/churn numbers leadership acts on | Manual reconciliation burden | Complete 10-account spot-check |

## Engineering and Operational Health Details

| Indicator | Status |
|-----------|--------|
| **Build / CI** | **Red** on `master` (Jun 25): `ERESOLVE` vitest/coverage-v8 conflict; tests/lint never ran in CI for that push |
| **Test signal** | **Green locally:** 763 tests, 76 files (`npm test`, Jun 26) |
| **Deployment / release** | No deployment artifacts or release notes in workspace |
| **Defect trends** | Multiple fix commits (`cd2ff20` CTA progress, cerebro merge fixes in open PRs) |
| **Incidents / escalations** | Not available in workspace |
| **Observability** | Structured JSON logging + `X-Request-Id` on refresh (`docs/audit/04_phase2_3_summary.md` PR-B4) |
| **Security / compliance** | Read-only CI guard enforced; single gated Slack send path |
| **Performance** | Refresh perf commits Jun 24; Glean search deduplication |
| **Data quality** | Cerebro freshness guards added (`650bff0`); validation checklist still open |
| **DORA metrics** | **Metric gap:** deployment frequency, lead time, change failure rate, MTTR—not instrumented. **Recommendation:** track CI pass rate + refresh job duration in `audit_log`. |

## Evidence Summary

| Category | Count / Status |
|----------|----------------|
| PRs reviewed | Not available in workspace (CI runs reference open PRs on `cursor/*` branches) |
| Commits reviewed | **7** on `master` (Jun 22–25) + **5** prior (Jun 18–24 CTA/forecast work) |
| Tickets reviewed | Not available in workspace |
| Docs reviewed | `README.md`, `docs/engineering/renewal-metrics.md`, `docs/engineering/cta-framework.md`, `docs/audit/04_phase2_3_summary.md`, `.windsurf/workflows/expand3-cta-generator.md` |
| Dashboards / metrics reviewed | CTA scan (`expand3_cta_scan_2026-06-25.md`), CTA log (`expand3_cta_log.jsonl`), GitHub Actions runs |
| Incidents / escalations reviewed | Not available in workspace |
| AI enablement artifacts reviewed | Glean Adaptive forecast integration (README); v2 CTA reasoning workflow |

<div style="page-break-after: always;"></div>

# Page 3 — Recommendations and Focus Areas for Next Week

## Recommended Focus Areas for Next Week

| Priority | Intended Outcome | Connection to CSE Goals | Expected Retention / Portfolio Impact | Dependency or Risk | Success Signal |
| -------- | ---------------- | ----------------------- | ------------------------------------- | ------------------ | -------------- |
| **1. Restore green CI on `master`** | Every push runs lint + 763 tests + smoke | Engineering delivery health | Prevents silent regressions in renewal/CTA logic | vitest peer-deps fix | Next `master` push shows CI green |
| **2. Close the CTA loop** | Move open CTAs from generated → acknowledged → done | Renewal risk prioritization; account activity visibility | Focus manager time on top ~10 by `priority_score` (~$1M+ combined ATR) | 26/31 open; low `team_aware` | ≥50% open CTAs `done` or `team_aware` by Jul 3 |
| **3. Pilot account plans on 3 at-risk renewals** | Evidence-first plans for Antylia, Devex, Leafly-class accounts | 6–8Q portfolio management; strategic engagement coaching | Earlier intervention on near-term renewals (Jul 2026 dates in scan) | Feature flag enablement | 3 plans generated + reviewed in manager 1:1s |
| **4. Validate one quarter of renewal metrics** | Reconcile `/renewals` GRR/churn to SFDC for one FQ | ATR retention support (board visibility) | Leadership can trust dollar figures in forecast script | Manual SOQL spot-check | Checklist items for one quarter marked complete |
| **5. Ship CTA job progress UI** | Managers see scan progress; fewer duplicate runs | AI adoption / operational confidence | Reliable weekly scan cadence | Uncommitted diff | Merged + demo on `/ctas` generate flow |

## Staff Engineer Recommendations

| # | Recommendation | Why Now | Expected Impact | Owner / Partner | Suggested Next Action |
|---|----------------|---------|-----------------|-----------------|----------------------|
| 1 | **Fix CI peer-dependency conflict** | `master` has been red since Jun 25; blocks confident merges | Restores delivery predictability | Engineering | Pin `@vitest/coverage-v8` to vitest 1.x-compatible version or upgrade vitest to 4.x |
| 2 | **Institute weekly CTA review ritual** | 31 plays generated but 26 open; follow-through fields unused | Converts tooling into retention action | CSE Manager | 30-min review of top 10 CTAs by `priority_score`; mark `team_aware` in log |
| 3 | **Enable account plan pilot** | Generator shipped Jun 22 but feature-flagged | Shifts engagements from reactive hygiene to strategic plans | CSE Manager + Staff Eng | Enable flag for 3 accounts; review output in `/accounts/[id]` |
| 4 | **Complete SFDC reconciliation for one quarter** | All validation checklist items unchecked | Board-visible retention metrics become trustworthy | CSE Manager + Ops | Run SOQL from `renewal-metrics.md` for current prospective quarter |
| 5 | **Instrument refresh duration** | Perf work landed but no measured baseline | Proves operational confidence for daily manager use | Engineering | Log `refresh.duration_ms` in `audit_log`; review weekly p50/p95 |

## Risks to Watch

| Risk | Impact on CSE Goals | Current Mitigation | Recommendation |
| ---- | ------------------- | ------------------ | -------------- |
| CI red on `master` | Slows retention tooling fixes | Local tests pass | Fix this week before next feature push |
| Low CTA closure rate (26/31 open) | Renewal risks identified but not acted on | CTA log tracks `status` | Manager weekly review + `team_aware` discipline |
| No measured ATR retention trend | Cannot prove progress toward 10% board goal | Renewal dashboards exist | SFDC reconciliation + export weekly GRR snapshot |
| `team_aware` at 10% (3/31) | Account activity invisible to broader team | Slack channel mapping exists | Require channel acknowledgment before CTA ages past `check_back_date` |
| Feature flags gate account plans | 6–8Q planning tool may be unused | Code complete | Explicit pilot enablement decision |
| Cerebro/Glean data gaps | Health signals incomplete on some accounts | `data_quality_gap` play type; fallback scoring | Review `/admin/data-quality` ARR exposure weekly |
| Technical debt in dependency tree | Future merges may fail silently | `npm test` locally | Align vitest ecosystem; add `npm ci` to pre-push habit |

## AI Adoption Opportunity

**Recommended AI enablement use case:**  
Weekly **renewal-risk triage brief** — use Glean Adaptive chat (same pattern as forecast Health Snapshot) to produce a 1-page manager brief from the top 10 open CTAs plus account-plan signals.

**Why it matters:**  
Connects AI to **renewal risk triage** and **portfolio-level retention review**, turning structured MDAS data into coaching-ready narrative for CSE manager 1:1s.

**How to pilot next week:**  
Before Monday standup, run forecast generation for current quarter; paste top 10 open CTAs from `expand3_cta_log.jsonl` into a Glean chat with prompt: *"For each account, state renewal date, ATR at risk, one recommended manager action, and whether exec engagement is needed."* Review output with one CSE pod lead.

**Success signal:**  
Pod lead confirms brief was usable in ≥1 customer conversation without manual re-research; note which accounts triggered exec-engagement recommendation.

## Closing Staff Engineer Assessment

- **Right problems?** Yes—MDAS is converging on the CSE shift: forward-quarter visibility, renewal-dollar prioritization, and manager-directed CTAs. The gap is **operational adoption and measured outcomes**, not feature absence.
- **Quarter-by-quarter vs 6–8Q?** Infrastructure supports 6–8Q (8-quarter prospective views, 8Q CTA window, account plans). **Behavioral evidence** (CTA play mix, open closure rate, unchecked validation) still resembles quarterly execution.
- **Highest-leverage action next week:** Restore CI green, then run a **manager-led CTA closure session** on the top 10 open plays—this converts $3.7M flagged ATR into accountable team action faster than new features.
- **Leadership decision needed:** Approve engineering time to fix CI immediately; align CSE managers on weekly CTA review cadence and account-plan pilot accounts.

---

*Evidence base: `master` commits Jun 22–25, `expand3_cta_scan_2026-06-25.md`, `expand3_cta_log.jsonl`, local test run (763/763), GitHub Actions run `28193718579`, engineering docs in `docs/engineering/`.*
