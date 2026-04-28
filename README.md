# MDAS — Manager's Dashboard and Decision Support System (Expand 3, v0)

Local-first, **read-only** decision-support app for the Customer Solution Engineering manager of the Expand 3 franchise at Zuora.

## Architecture

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind
- **Backend**: Next.js API routes (read endpoints) + a separate Node worker process for refresh/scoring orchestration
- **Database**: Postgres 16 (heavy use of JSONB for snapshot payloads)
- **Queue**: Postgres `LISTEN/NOTIFY` + a `refresh_jobs` table (no Redis)
- **Read-only enforcement**: code structure (no `adapters/write/` directory), runtime `readOnlyGuard()`, and a CI guard that fails the build if any write paths or write-capable MCP tool names appear

```
mdas/
  apps/
    web/          # Next.js UI + read-only API
    worker/       # Refresh + scoring orchestrator
  packages/
    canonical/             # Shared TypeScript types
    scoring/               # Pure scoring functions
    forecast-generator/    # Weekly markdown generator
    db/                    # Schema, migrations, query helpers
    adapters/
      read/
        salesforce/         # Read-only SOQL adapter
        cerebro-glean/      # Cerebro via Glean MCP search (no Cerebro REST API exists)
        gainsight/          # Gainsight via Glean native connector
        staircase-gmail/    # Staircase.AI via Gmail (no Glean connector)
        zuora-mcp/          # Zuora Remote MCP (read-only allowlisted tools)
        glean-mcp/          # Cross-source synthesis
        local-snapshots/    # Self-adapter for prior snapshots
        _shared/            # readOnlyGuard, rate limiter
      mock/                  # 236 Expand 3 account fixtures from Glean
  mcp.config.json
  docker-compose.yml
  scripts/
    ci-guard.mjs    # CI guardrails for read-only enforcement
    migrate.mjs     # Apply SQL migrations
    seed.mjs        # Two refreshes (prior + current) for non-empty WoW
```

## Application Management

### Start the application

Using Docker Compose (recommended):
```sh
make up
# Or: docker compose up -d --build
```

This starts all services: PostgreSQL database, Next.js web app (port 3000), and worker process.

### Stop the application

```sh
make down
# Or: docker compose down
```

This stops all running containers but preserves database data.

### Restart the application

```sh
make down && make up
```

This stops all containers and restarts them fresh.

### View logs

```sh
make logs
# Or: docker compose logs -f
```

View real-time logs from all running services.

### Quickstart (mock data)

First-time setup with mock data:

```sh
cp .env.example .env
docker compose up -d --build db        # only DB at first
npm install
npm run migrate
npm run seed                            # two refresh runs (prior + current)
npm run dev:web                         # http://localhost:3000
```

Or full Docker:

```sh
docker compose up -d --build
# After services are healthy, on the host:
npm run migrate && npm run seed
```

## Read-only guarantees

1. The `packages/adapters/write/` directory **does not exist**. CI fails the build if it ever appears.
2. `mcp.config.json` lists allowed MCP tool names per server. CI fails if any name matches `/^(create|update|cancel|delete|post|send)_/`.
3. Every read adapter exports `isReadOnly: true`. CI verifies this.
4. `readOnlyGuard()` (in `packages/adapters/read/_shared`) wraps every outbound HTTP. It allows `GET`/`HEAD` and only POSTs to a small allowlist of query/search endpoints.
5. The `audit_log` table records every refresh: timestamp, sources, row counts, scoring version, success/failure.

A future phase may add Salesforce FLM Notes writeback. **For v0, no write code, scaffolding, or hints exist anywhere.**

## Sources & exact field names

See the inline comments in each adapter for full SOQL and field mappings:

- **Salesforce**: `packages/adapters/read/salesforce/src/index.ts`
- **Cerebro (via Glean)**: `packages/adapters/read/cerebro-glean/src/index.ts` — primary risk identifier is the AI-generated **Risk Category** (Low/Medium/High/Critical), passed through verbatim. The 7 risk booleans + sub-metrics (Utilization, Engagement, Suite, Share, Legacy Tech, Expertise, Pricing) are surfaced on the drill-in.
- **Gainsight (System of Record for CSE Sentiment)**: `packages/adapters/read/gainsight/src/index.ts`. Sentiment is read from Salesforce because Gainsight pushes it there; structured CTAs/Tasks (owner + dueDate) come from Gainsight directly.
- **Staircase.AI**: `packages/adapters/read/staircase-gmail/src/index.ts` (Gmail-only — no Glean connector exists).
- **Zuora Remote MCP**: read-only via OAuth 2.0; allowlisted tools are `query_objects`, `ask_zuora`, `account_summary`, `run_report`. Quota: 5,000 req/tenant/month — limited client-side.
- **Glean MCP**: cross-source synthesis (account plans, Slack, Gmail, Calendar, Zoom transcripts, SFDC notes, Gainsight notes).

## Scoring (v0.1.0)

- **Risk identifier**: direct passthrough from Cerebro Risk Category. Falls back to "count of true Cerebro risk booleans" only when Cerebro is missing. UI shows level verbatim plus a `via cerebro` / `via fallback` label.
- **Bucket**: Confirmed Churn → Saveable Risk (Critical/High) → Healthy.
- **Upsell signal score (0–100, additive cap 100)** — see Section 8.3 of the design doc.
- **CSE hygiene rules** — six rules including the all-important `cseSentimentCommentaryLastUpdated` staleness check.
- **Manager priority**: bucket → Risk Category → days to renewal → ATR descending.

## Weekly Forecast Update generator

`packages/forecast-generator/src/index.ts`. Pure function: `(views, changeEvents, asOfDate) ⇒ markdown`. Sections: Headline, Confirmed Churn, Saveable Risk, Upsell, CSE Hygiene Call-Outs, Asks of Leadership, Talk Track, Source Evidence. Every dollar figure comes from the snapshot; every account mention has at least one source link in the footer.

## UI

- `/` — Manager Dashboard with stat tiles + 3 columns (Confirmed Churn / Saveable Risk / Upsell) + Refresh button + Generate Update CTA
- `/accounts` — ranked action list (default sort = Manager Priority)
- `/accounts/[accountId]` — drill-in: Cerebro Risk Analysis, sentiment commentary, opps with FLM/SC notes, workshops, meetings, account plans, WoW changes, hygiene issues, source links
- `/wow` — Week-over-Week changes grouped by category
- `/hygiene` — Hygiene worklist with per-CSE rollup + per-rule coaching prompts
- `/forecast` — Generate / Copy / Download the weekly markdown
- `/admin/refresh` — last 20 refresh runs, per-source freshness, audit log tail

## Switching from mocks to real adapters

Each adapter is opt-in via an `ADAPTER_*` env var. Adapters return empty when their credentials are missing (no crashes), so adapters can be enabled one at a time without code changes.

### Salesforce (PR-3)

```
ADAPTER_SALESFORCE=real
SALESFORCE_CLIENT_ID=...               # Connected App client ID
SALESFORCE_CLIENT_SECRET=...           # Connected App secret
SALESFORCE_REFRESH_TOKEN=...           # OAuth refresh token (rotate as needed)
SALESFORCE_INSTANCE_URL=https://zuora.my.salesforce.com
```

Runtime: `@jsforce/jsforce-node` REST + Bulk API 2.0. Workshop_Engagement__c queries auto-escalate to Bulk above 1500 rows. See `docs/integrations/salesforce.md` and `docs/field-map.md`.

### Cerebro (via Glean) (PR-4)

```
ADAPTER_CEREBRO=real
GLEAN_MCP_TOKEN=...
GLEAN_MCP_BASE_URL=https://api.glean.com
```

Reads from Glean's `app:cerebro / type:healthrisk` documents — populates the 7 risk booleans + 16 sub-metrics. Risk Category and Risk Analysis are NOT in Glean's Cerebro index; the scoring layer's `RiskIdentifier { source: 'fallback' }` activates per Section 10. See `docs/integrations/cerebro.md`.

### Glean account-context + evidence (PR-5)

```
ADAPTER_GLEAN_MCP=real
GLEAN_MCP_TOKEN=...                    # same token as Cerebro
GLEAN_MCP_BASE_URL=https://api.glean.com
GLEAN_CONCURRENCY=5                    # optional, default 5
```

Reads gdrive (account plans / QBR / business reviews), googlecalendar, slack, and Staircase Gmail summaries (metadata-only — privacy guard) for every account in the prior snapshot. See `docs/integrations/glean.md` for the privacy rationale.

### Gainsight (via Glean) (PR-7)

```
ADAPTER_GAINSIGHT=real
GLEAN_MCP_TOKEN=...                    # same token as Cerebro / Glean
GLEAN_MCP_BASE_URL=https://api.glean.com
```

Reads Glean's `app:gainsight / type:calltoaction` documents (Gainsight CTAs / Risk tasks) and joins to canonical Account by case-insensitive name match. Populates `gainsightTasks` with up to 25 open-first CTAs per account. See the Gainsight section of `docs/integrations/glean.md` for the join rationale and field map.

## Testing & CI

```sh
npm test               # vitest: scoring + SF/Cerebro/Glean/Gainsight mappers (61 tests as of PR-7)
npm run ci:guard       # read-only structural enforcement
npm run lint           # tsc -b
```

CI: see `.github/workflows/ci.yml`. Includes a smoke check that boots the web app against mock data and fetches all seven views.

## Out of scope for v0

Multi-user auth, FLM Notes writeback, real-time push, Slack/email notifications, mobile views, direct Cerebro API (does not exist), direct Staircase API (no connector), local Zuora MCP (Remote only), and any tool that writes to any system.
