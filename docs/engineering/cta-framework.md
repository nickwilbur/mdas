# Expand 3 CTA Framework

## Overview

Expand 3 CTAs are manager-directed asks for CSEs/AEs on at-risk accounts. The system has three layers:

1. **Generation** — `@mdas/cta-engine` evaluates MDAS `AccountView` snapshots and emits `CTARecord` objects
2. **Persistence** — `expand3_cta_scan_<date>.md` + `expand3_cta_log.jsonl` (file-based, no DB table)
3. **Presentation** — `/ctas` board + `cta-utils.ts` Slack voice rendering

```
MDAS refresh → AccountView snapshots
  → scripts/generate-ctas.ts
  → @mdas/cta-engine (rules + dark detection + dedup)
  → expand3_cta_scan_*.md + JSONL
  → CTABoard + generateSlackMessage()
```

## CTA types

| `play_type` | Trigger summary | Primary sources |
|-------------|-----------------|-----------------|
| `dark_account` | Weighted dark signals ≥ threshold (default 2.0) | SFDC, Cerebro, Glean, Engagio |
| `dark_renewal` | Renewal in 4Q + stale opp or no recent activity | SFDC opps, activity |
| `utilization_risk` | Cerebro utilization flag or PBU < 65% | Cerebro |
| `engagement_risk` | Cerebro engagement risk | Cerebro |
| `no_strategic_engagement` | Zero VP+ meetings + renewal ≤ 180d | Cerebro |
| `surprise_churn_watch` | Yellow sentiment + renewal ≤ 180d, no active plan | SFDC |
| `sentiment_stale` | Commentary > 90d + renewal ≤ 180d | SFDC |
| `managed_wind_down` | Commentary documents exit/wind-down | SFDC commentary |
| `suite/share/legacy/pricing/expertise_risk` | Respective Cerebro boolean | Cerebro |
| `data_quality_gap` | Missing Cerebro + Glean on high-ARR account | Adapter errors |
| `confirmed_churn_retro` | Confirmed churn — retro only | SFDC |

One CTA per account per scan — highest `priority_score` wins.

## Dark account definition

An account is **dark** when weighted dark signals sum to **≥ 2.0** (configurable) within a **90-day** lookback (configurable).

| Signal | Weight | Source |
|--------|--------|--------|
| No/stale sentiment commentary (>90d) | 1.0 | Salesforce |
| No dedicated CSE (digital coverage) | 1.0 | Salesforce |
| No Slack channel in SFDC | 1.0 | Salesforce |
| No meetings/workshops/commentary in lookback | 1.0 | Glean + SFDC |
| No workshop in 365d | 0.5 | Salesforce |
| Cerebro engagement risk | 1.0 | Cerebro |
| Low Engagio minutes (<10 in 30d) | 0.5 | Salesforce |

**Confidence:** high = 3+ independent sources; medium = 2; low = structural-only (no CSE + no Slack).

**Severity boosters:** renewal ≤90d, ARR ≥ $500K, composite `riskScore` ≥ 50.

The forecast module uses a separate **7-day** simple dark list (`findSimpleDarkAccounts`) for weekly briefs — not the same threshold as CTA dark_account.

## Configuration

Defaults in `packages/cta-engine/src/config.ts`:

```typescript
darkAccountLookbackDays: 90
darkAccountMinWeight: 2.0
darkRenewalOppStaleDays: 60
renewalWindowQuarters: 8
dedupWindowDays: 14
maxCtasPerScan: 50
lowEngagementMinutes30d: 10
utilizationThresholdPct: 65
sentimentStaleDays: 90
renewalFiscalYears: [] // computed at scan time via mergeConfig() — FY26 through current + 8Q
requireRiskOrUnhealthy: true
```

## Data dependencies

| Field | Adapter | Used for |
|-------|---------|----------|
| `cseSentiment`, commentary | Salesforce | Sentiment plays, stale detection |
| `cerebroRisks`, `cerebroSubMetrics` | Cerebro REST/Glean | Risk family, PBU, exec meetings |
| `recentMeetings` | Glean MCP | Activity/dark detection |
| `workshops` | Salesforce | Activity proxy |
| `engagementMinutes30d` | Salesforce (Engagio) | Engagement decay |
| `gainsightTasks` | Gainsight | Anti-signal dedup |
| `riskScore` | `@mdas/scoring` | Priority boost |
| `sourceErrors` | Worker | Data quality CTAs |

**Not available:** support tickets, product login telemetry, health score delta, SFDC `Last_Task_Completed`.

## Messaging tone

CTA copy follows the v2 voice in `apps/web/src/lib/cta-utils.ts`:

- Manager peer ask, not dashboard alert
- `@firstname` lowercase, 2–4 sentences, two facts max
- Play-type-specific asks via `managerAsk()`
- Evidence in `drivers` (narrativized by `generateSlackMessage()`)
- Data gaps in JSON only, never in Slack body

When adding a play type, update: `cta-utils.ts` (`PLAY_TYPE_DISPLAY`, `managerAsk`), `CTABoard.tsx` labels, `cta-engine/build.ts` `getRequestedAction()`.

## Scope

MDAS stores **active Expand 3 accounts only** (see `packages/canonical/src/expand3.ts`):

- `franchise === 'Expand 3'`
- Not confirmed churn (sentiment, notice fields, or churn opps)
- Salesforce ingest excludes `Customer_Status__c = 'Churned (Live)'`
- Worker calls `filterExpand3Snapshot()` before every persist; snapshots use `replace*` writes so orphaned rows are removed

To repair an existing bloated snapshot: `npm run snapshot:prune-expand3`

CTAs are generated from this book (optional intersection with the SFDC Expand 3 report JSON).

**Renewal window (default):** accounts with an **open renewal** whose close date falls in the MDAS fiscal horizon — all history from FY26 Q1 (or earlier if present in data) through **current quarter + 8 future quarters** (rolling). `renewalFiscalYears` is derived at scan time in `mergeConfig()` from `defaultRenewalFiscalYears()` in `packages/cta-engine/src/fiscal.ts`.

**CTA eligibility gate (default):** emit a CTA when a **risk/dark play** matches (`dark_account`, `dark_renewal`, Cerebro risk family, etc.) or when `accountNeedsCtaAttention` is true. **Green sentiment does not skip darkness or risk evaluation** — the same dark-signal detector and Cerebro flags run regardless of sentiment color. Only `data_quality_gap` on an otherwise healthy account is suppressed (`requireRiskOrUnhealthy: true`).

## Deduplication & lifecycle

- **Dedup key:** `{renewalOpportunityId}:{play_type}` when a renewal opportunity is linked; otherwise `{salesforceAccountId}:{play_type}`
- **Window:** 14 days — skip if open CTA exists with same key and unchanged signals
- **Update:** refresh drivers/priority if signal worsens within window
- **Cap:** max 50 CTAs per scan (by `priority_score`)
- **Full scan refresh:** `npm run cta:generate` archives the prior JSONL to `expand3_cta_log.archive.<date>.jsonl`, replaces the log with the new scan only, and deletes older `expand3_cta_scan_*.md` files. The `/ctas` page reads the latest scan file only.
- **Single-account runs:** `--account` appends without clearing prior CTAs

## Renewal opportunity association & progress tracking

Each Expand 3 CTA is linked to exactly one **renewal opportunity** via `renewal_opportunity_id` (set at generation from `nextFutureRenewalOpp()`). The account relationship is derived from that opportunity in the renewal pipeline — not stored as a separate source of truth.

Progress fields on `expand3_cta_log.jsonl` entries:

| Field | Purpose |
|-------|---------|
| `status` | `open`, `in_progress`, `blocked`, `done` (legacy `closed_done` → `done`, `stalled` → `blocked`) |
| `assigned_owner` | Optional override of generated `primary_owner` |
| `due_date` | Action due date (defaults to `deadline` at creation) |
| `progress_note` | Latest progress update |
| `created_at` / `updated_at` / `completed_at` | Timestamps |

**API:** `PATCH /api/ctas/[ctaId]/progress` — update status, owner, due date, or note.

**UI surfaces:**
- `/ctas` — full board with progress controls; deep-link via `?cta=<cta_id>`
- `/renewal-analysis` pipeline table — **CTA** column shows open play status per opportunity

**Backfill legacy logs:**

```bash
npx tsx scripts/backfill-cta-opportunity-ids.ts
```

Parses `renewal_opportunity_id` from `renewal_opportunity_url` and rewrites opportunity-scoped `dedup_key` values.

## Adding a new CTA type

1. Add to `CTAPlayType` in `packages/cta-engine/src/types.ts`
2. Add rule in `packages/cta-engine/src/rules.ts`
3. Add `getRequestedAction` + optional `managerAsk` copy
4. Add tests in `packages/cta-engine/src/rules.test.ts`
5. Update UI labels in `cta-utils.ts` and `CTABoard.tsx`

## Operations

```bash
npm run cta:generate      # full scan (needs DB snapshot or /tmp/sfdc_all_accounts.json)
npm run cta:dry-run       # preview without writing files
```

Structured logs: `cta.scan.complete` (JSON on stderr), `cta.job.closed` (API).

**Debugging dark accounts:** run `assessDarkAccount(view, config)` in a test or REPL with the account's `AccountView` payload.

## Known limitations

- SFDC Expand 3 report (`/tmp/sfdc_all_accounts.json`) scopes universe separately from MDAS SOQL
- Gainsight dedup uses name match only
- `situation_read` / `point_of_view` require Cascade/LLM pass — programmatic scans leave null
- Follow-up/escalation mode not implemented in code
