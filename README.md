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

## Corporate TLS interception (Zscaler etc.)

If your laptop sits behind a corporate proxy that re-signs HTTPS traffic
(Zscaler, Netskope, ZScaler ZIA, Palo Alto, etc.), the worker container
will fail every outbound HTTPS call with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
because the host's macOS keychain trusts the corp root CA, but the
container does not. One-time setup:

```sh
# 1. Export the corporate root cert(s) from the system keychain into
#    a PEM bundle the container will mount as :ro. The file is
#    gitignored — the certs are public, but the path is per-machine.
security find-certificate -a -c "Zscaler" -p \
  /Library/Keychains/System.keychain > .docker-ca.pem
# (substitute your own corp issuer name as needed; check via:
#  echo s_client | openssl s_client -connect example.com:443 2>&1 \
#    | grep issuer=)

# 2. Rebuild the worker (Dockerfile installs ca-certificates) and
#    restart. docker-compose.yml mounts .docker-ca.pem at
#    /etc/mdas-extra-ca.pem and exports NODE_EXTRA_CA_CERTS to it.
docker compose up -d --build worker
```

Verify:

```sh
docker compose exec -T worker node -e \
  'fetch(process.env.GLEAN_MCP_BASE_URL).then(r=>console.log(r.status))'
# Expect: 401 (real response from upstream, NOT a TLS error).
```

## Data sources & precedence

Two firm rules govern every adapter and merge step:

1. **Salesforce is the system of truth.** When two adapters produce a
   value for the same canonical field on the same account, Salesforce
   wins. The orchestrator enforces this by running real adapters in
   the order `localSnapshots → cerebro → gainsight → glean-mcp →
   staircase → zuora-mcp → salesforce`, with a naive last-write-wins
   merge — Salesforce, scheduled last, overrides every other source on
   shared fields (account name, sentiment, owner, etc.).

2. **Glean is a backup and enrichment source, never primary.**
   Use Glean (and its MCP server) for fields no other system surfaces:
   AI risk analysis text, recent-meeting summaries, account-plan doc
   links, Slack thread snippets, Gainsight CTAs (where Gainsight has
   no direct API). Do **not** scrape spreadsheets discovered through
   Glean as a substitute for a real source — `gdrive` documents may
   appear in Glean search results but are explicitly out of scope as
   data sources for this pipeline. The `cerebro-glean` adapter
   already enforces this with `datasources: ['cerebro']` on every
   query (the structured Cerebro corpus, not gdrive).

The `cerebro-glean` adapter intentionally does **not** populate
`cerebroRiskCategory` or `cerebroRiskAnalysis` because Glean's
`cerebro` datasource does not expose those fields in `matchingFilters`.
The UI handles this gracefully by labeling the risk badge `via fallback`
(the count-of-true-booleans heuristic) until a non-spreadsheet source
for Risk Category becomes available.

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

**Churn-save filter on Hedge / Close-Gap (2026-05-20):** The
`Accounts with Hedge` and `Accounts to Close Gap` lines surface only
**renewal** opportunities the rep is actively forecasting *down*
against ATR. The filter is the conjunction of three checks on the
opportunity (no account-bucket gate — Kustomer is the verified
counter-example, a Healthy-bucketed account whose down-forecast
renewal is on the manager's Clari hedge line):

1. SFDC `Opportunity.Type` contains "Renewal" (excludes Amendment /
   Contracted Ramp / New Business — those carry expansion hedge, not
   save hedge).
2. SFDC `fml_Manager_ForecastCategory__c` (preferred, falling back
   to standard `ForecastCategoryName`) is **populated** and is **not**
   in the dropped set (`Omitted`, `Closed`, `Closed Lost`, `Closed
   Won`). Null is treated as excluded — a missing manager category
   means the opp has not been pulled onto the manager's forecast line.
   We do NOT drop the `Upside` / `Targeted Upside` / `Committed Upside`
   family — Finale, Zello, and Kustomer all sit in those categories
   while also showing a net downsell (the rep is hedging some upside
   *and* forecasting a save loss on the same opp).
3. The opp itself carries a **down-forecast signal**: `knownChurnUSD
   > 0` OR negative `Forecast Most Likely` OR negative ACV delta. This
   is the definition of a churn-save situation — the rep is
   forecasting renewal dollars below ATR baseline. Pipedrive is the
   verified counter-example: $25K hedge on a renewal, but ML and ACV
   delta are both $0, i.e., pure upside hedge, not a save.

A nested call-out under `Accounts with Hedge` — *Churn-save targets
not yet hedged in Clari* — lists renewals that pass the three checks
above but currently carry $0 forecast hedge, so leadership can decide
whether to pull them onto the hedge line.

**Health Snapshot section (2026-05-20):** Each quarter section now
renders a qualitative `Health Snapshot:` paragraph between the
dollar-KPI block (`Hedge:`) and the per-account sections
(`Accounts with Hedge`). The narrative is generated by
**Glean Adaptive chat** at script-generation time and is meant to
answer three questions the dollar figures can't on their own:
(1) how healthy is the quarter today, (2) how is it trending across
the snapshots so far this quarter, and (3) what's the one callout
that isn't obvious from the numbers. The trajectory series powering
the prompt is built by `apps/web/src/lib/forecast-trajectory.ts` —
it walks every successful refresh run since the start of the current
fiscal quarter, dedupes to the **last refresh of each calendar day**,
and computes a `QuarterKpiSnapshot` (Plan / Flash / Gap / Total Risk
/ Hedge / red+yellow account counts) per point. The pure renderer
(`@mdas/forecast-generator`) stays LLM-free: it accepts a
`healthSnapshot: { currentQuarter, nextQuarter }` string field on
`ForecastInput` and splices the text in verbatim. The web route
(`apps/web/src/app/api/forecast/route.ts`) is the only place the
Glean Adaptive call happens. On Glean failure (credentials missing,
upstream 5xx, timeout, empty reply) the narrative becomes the
stale-marker `[Narrative unavailable — Glean call failed]` so the
manager sees that they need to write the paragraph manually rather
than getting a silently empty block. When the trajectory series is
empty (cold-start refresh) the section is omitted entirely.

**Week-over-week header summary (2026-05-20):** The
`Week-over-week Changes` header line summarizes the net forecast-ML
delta across in-scope events (eligible churn-save accounts × renewal
opps): `net $X (regressions -$Y, improvements +$Z, N booked)`. Only
`forecastMostLikely` deltas contribute dollars (stage / close-date
moves are listed in the per-account bullets but never synthesize a
dollar value), and `N booked` counts distinct accounts whose renewal
opp transitioned to a `Closed/Won` stage during the window. When no
events are in scope the header reads `no movement this week`.

**Key Saves renewal-only filter (2026-05-20):** The red / yellow /
green Key Saves lists now apply the same renewal-only filter as the
Hedge / Close-Gap sections — `Opportunity.Type` must contain
"Renewal" and `fml_Manager_ForecastCategory__c` must be populated and
not in the dropped set (`Omitted`, `Closed`, `Closed Lost`,
`Closed Won`). Without this gate `topAccountsToCloseGap` was
surfacing Amendment / New Business / Contracted Ramp opps with
past-due close dates, which leadership can't act on as saves. Note
this is one filter looser than `isChurnSaveTarget`: we do not require
a down-forecast signal here because the green band legitimately
contains healthy renewals the manager wants to capture.

**Key Saves bullet format (2026-05-20):** Each Key Saves bullet
renders as `name ($amount) - <chip line> | <one sentence>`. The chip
line is a deterministic, scannable set drawn from data the manager
already reads in Clari — `Risk: <Cerebro Risk Category>; Sentiment:
<CSE Sentiment>; Renewal: <close date>; ML: <signed USD>` — with
empty chips omitted so sparse accounts still read compact. The prose
tail is the **first sentence** of `SE_Next_Steps__c` (HTML-stripped
via `cleanRichText`, capped at 200 chars at a word boundary) and
nothing else. We deliberately do **not** fall back to FLM/SLM notes,
CSE sentiment commentary, Cerebro risk analysis, or the synthetic
scoring rationale; those sources produced multi-paragraph rich-text
dumps that drowned the chip line on a leadership churn call.

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

## Cascade-relay bridge (interim, until SF + Glean tokens land)

While the worker waits on `SALESFORCE_*` + `GLEAN_MCP_TOKEN`, real
Salesforce data can be bridged into the latest snapshot via Cascade's
own Glean MCP integration (the same OAuth path Cursor / Windsurf
already use, no service-account token required).

The bridge respects the data-source precedence rules above:
Salesforce-flavored fields (account name, owner, CSE sentiment, ARR,
tenant ID, CS coverage, franchise, active product lines) override
mock `localSnapshots` data; Glean-flavored fields (Gainsight CTAs,
account plan links, recent meetings) only fill gaps. The bridge
becomes a no-op the moment the worker's salesforce adapter starts
producing data on its own.

```sh
# 1. Cascade interactively populates seed/cascade-bridge.json from
#    mcp2_search(app=salescloud) + mcp2_chat. The fixture is
#    gitignored — it contains real customer ARR + sentiment.
# 2. Merge into the latest refresh's snapshot_account + re-score.
npx tsx scripts/import-cascade-bridge.ts
# Output:
#   Fixture: 26 bridged accounts
#   Merged: SF=26 Gainsight=0 (of 236 snapshot accounts)
#   Re-scored 236 account_view rows
#   Bucket distribution: { Confirmed Churn: 12, Healthy: 217,
#                          Saveable Risk: 7 }
```

The script is **idempotent** — re-running with a refreshed fixture
overwrites the SF-marked fields cleanly, leaving Cerebro/Gainsight
provenance untouched. UI source dots correctly show
`salesforce` (green) for bridged accounts and grey "no data" for
the rest.

## Testing & CI

```sh
npm test               # vitest: scoring + adapters + UI helpers (73 tests as of PR-8)
npm run ci:guard       # read-only structural enforcement
npm run lint           # tsc -b
```

CI: see `.github/workflows/ci.yml`. Includes a smoke check that boots the web app against mock data and fetches all seven views.

## Out of scope for v0

Multi-user auth, FLM Notes writeback, real-time push, Slack/email notifications, mobile views, direct Cerebro API (does not exist), direct Staircase API (no connector), local Zuora MCP (Remote only), and any tool that writes to any system.
