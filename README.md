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
not yet hedged in Clari (ATR exposed)* — lists renewals that pass the
three checks above but currently carry $0 forecast hedge, so
leadership can decide whether to pull them onto the hedge line.

**What these two sections mean to leadership.** The script is built
from the recurring NoAM FY27 Renewal Script churn-call template
(Sam Lawley's weekly leadership read-out). The KPI block at the top
of each quarter shows two negative-dollar lines:

- **Total Churn/Downsell Risk / Baseline** — the worst case, i.e.
  full ATR exposed across every Confirmed Churn + Saveable Risk
  renewal in the quarter.
- **Churn/Downsell Flash / Most Likely** — what the rep is actually
  calling, after saves the team believes they'll land.

The delta between Total Risk and Flash is the *implicit save plan*:
dollars at risk we think we can hold. Everything below the KPI block
exists to name the accounts that have to convert for that delta to
be real. Two sections do this from different angles:

- **`Key Saves/Improvements to close the gap from Total Churn/Downsell
  risk to Flash:`** — the per-account drill-in, split into red /
  yellow / green sub-lists. This answers "which named renewals have
  to land for Flash to hold, and what's the next step on each?"
  Red = risk trending and needs intervention; yellow = path to add
  hedge to the line; green = healthy renewals already counted on
  that we still need to capture. In Sam's live entries these read
  like `New Relic ($1,069,740) - Flagging almost full churn, save
  $100k; proposed early renewal pricing for full renewal + upsell`
  — one named account, dollars at stake, single-sentence ask.
- **`Churn-save targets not yet hedged in Clari (ATR exposed):`** —
  the inverse lens. `Accounts with Hedge` above it lists saves the
  CSE has *already* pulled onto the Clari hedge line. This section
  flips it and surfaces renewals that look like saves to MDAS
  (renewal + carried forecast category + a down-forecast signal) but
  carry $0 hedge today. It's the explicit "you should add these to
  the line" ask — dollars MDAS believes are achievable but that the
  rep hasn't claimed yet. Sized by **ATR** (what hedging the account
  would contribute), not ACV, so leadership reads the header total
  as "dollars on the table you haven't claimed."

The "Key Saves" section runs one filter looser than the "not yet
hedged" section: it skips the down-forecast requirement so healthy
renewals (green band) still show up as capture targets. The "not yet
hedged" section is stricter and also excludes anything already in
the hedge list above it, so the two never double-count.

**Per-account Glean context on Key Saves (2026-05-21):** The
structured chip line on each Key Saves bullet doesn't carry the
qualitative "why is this on the list?" context the manager actually
reads off Slack / Gmail / account plans / CSE notes / meeting
transcripts. The web route now layers that on with a per-account
Glean Adaptive chat call (`apps/web/src/lib/forecast-account-context.ts`).
The deterministic renderer stays LLM-free: it accepts an opaque
`accountContext: Record<accountId, string>` map on `ForecastInput`
and appends each blurb to the matching bullet as `|| Context: <1-2
sentences>` (label is `Context:` not `Glean:` so the leadership read
isn't anchored to the tool that produced it). Calls are bounded to the ≤15 accounts that actually
appear in the red / yellow / green Key Saves lists, run with a
concurrency cap of 4, and the prompt grounds the model in the
structured chip-line facts plus an explicit `NONE` sentinel for
"no soft signal beyond what's already structured" (those bullets
render with no Glean tail rather than filler). Failures become a
stale-marker `[Glean context unavailable — <reason>]` per-account,
which the manager sees in the pasted script so they know to write
the why themselves before the leadership call.

**Glean-flagged emerging risks (2026-05-21):** Sibling sub-section
under `Churn-save targets not yet hedged in Clari` that surfaces
accounts the deterministic structured filter missed but Glean
flagged from soft signals (Slack escalations, exec-level Gmail,
account-plan notes, meeting transcripts). The identify call lives in
`apps/web/src/lib/forecast-glean-risks.ts`. It's bounded to the
in-quarter Expand 3 account universe and asks Glean for a strict
JSON envelope; the parser drops any accountId not in the bounded
input set (hallucination guard — a missed account is recoverable,
an invented one on a leadership churn-call is not). The renderer
dedupes against accounts already on the structured `Accounts with
Hedge` / `not yet hedged` lists so the two never overlap. Block
omitted entirely when no entries survive deduping.

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

## Customer Slack channel workflow (`/admin/slack`)

Internal tool to map Expand 3 customers to their internal Zuora Slack
channels and — gated behind a hard env toggle and per-message
confirmation — send a single message to one mapped channel at a time.
This is the **only** write path in the codebase. It lives outside
`packages/adapters/` (which is read-only-enforced by `ci-guard.mjs`); the
send code is in `packages/slack-send/`.

### Source of truth for channel mapping

Resolved in this precedence order (first match wins):

1. **Manual override** — admin row in `customer_slack_mapping` with
   `source='override'`. Sticky across refreshes.
2. **Salesforce** — `Account.Internal_Customer_Slack_Channel__c`, read by
   the Salesforce adapter into `CanonicalAccount.salesforceSlackChannelUrl`.
3. **Sheet** — rows imported via `POST /api/slack/mappings/import-sheet`
   (CSV paste, no live Drive scraping). Source-of-record for accounts
   where SFDC is blank but the operational tracker has them.
4. **Heuristic** — `cust-{slugifyAccountName(name)}` candidate name only.
   Promoted to `mapped` (source=`heuristic`) if the candidate resolves
   to a public channel via Slack's `conversations.list`; otherwise stays
   `heuristic_candidate` and is NOT linked in the UI.
5. **Cache** — last good URL persisted by a previous refresh, used when
   the higher-precedence source goes empty.
6. Otherwise `missing_salesforce_channel` / `unresolved`.

Slack channels are never invented or auto-created. There is no silent
fallback from the customer channel to anywhere except the explicit
"test-to-self" mode the operator selects.

**Statuses** surfaced in the UI: `mapped`, `manually_overridden`,
`heuristic_candidate`, `missing_salesforce_channel`, `invalid_slack_url`,
`inaccessible_channel`, `unresolved`. The dashboard shows counts as
clickable tiles for filtering; gaps are visible, not hidden.

### How refresh works

- `POST /api/slack/mappings/refresh` — full refresh of all Expand-3
  accounts.
- `POST /api/slack/mappings/refresh/:accountId` — single-account refresh.
- Refresh reads the latest `snapshot_account` payloads, applies the
  precedence rules above, calls Slack's read-only API where useful
  (see next paragraph), and UPSERTs into `customer_slack_mapping`.
  **Idempotent** with respect to source data — re-running with unchanged
  upstream produces the same status/URL on every row.
- Every refresh emits `slack.mapping.refresh.start` and
  `slack.mapping.refresh.complete` rows into `audit_log` with summary
  counts (mapped / inaccessible / heuristic / validated / changed).

**Slack API use during refresh** (when a read-only token is configured,
see auth section below):

- **`conversations.list`** — one pass per refresh. Builds an index of
  channels so we can resolve channel ids to real names and promote
  heuristic candidates whose `cust-{slug}` name appears in the index.
  - Bot token → `types=public_channel` (bot doesn't elevate to private).
  - User / xoxc token → `types=public_channel,private_channel` (Slack
    returns only what the underlying human user sees; not an elevation).
  - **Enterprise Grid caveat**: org admins can disable
    `conversations.list` for non-admin tokens via
    "Admin > Apps > Permissions for Apps > Restrict listing of channels".
    When enforced, the call returns `enterprise_is_restricted` and
    heuristic candidates cannot auto-resolve from a directory. Mapping
    refresh still works for SFDC-known channel ids (via
    `conversations.info`); use the per-row "Map URL" admin action
    described below to resolve the rest.
- **`conversations.info`** — bounded to 40 calls per refresh; used for
  channel ids the directory didn't resolve. Returns `channel_not_found`
  → row flips to `inaccessible_channel`; `is_archived: true` → archived
  flag. Both sticky across refreshes (once dead, always dead until a
  human un-sticks via override). NOT subject to the
  `enterprise_is_restricted` policy.
- A "recently validated live" guard skips re-validating channels that
  were validated within the last 24h, so the bounded budget rotates
  through pending rows instead of revalidating the same set every run.

Without a configured token, refresh still runs — it just can't validate
inaccessible channels or promote heuristic candidates.

### Per-row manual overrides

When `conversations.list` is blocked (Enterprise Grid, see above) or
when no token is configured, heuristic candidates can be resolved one
at a time via the per-row **Map URL** button on `/admin/slack` (shown
on rows whose status is `heuristic_candidate`, `unresolved`,
`missing_salesforce_channel`, `invalid_slack_url`, or
`inaccessible_channel`).

API: `POST /api/slack/mappings/override/:accountId` with body
`{ slackUrl, note? }`. The URL is parsed strictly (only canonical
`/archives/Cxxx...` shapes accepted), validated via
`conversations.info` when a read token is present (validation outcome
recorded but does NOT block the write — operator's word beats an
unreachable API), and written with `source='override'`. Override rows
are sticky across refreshes per the precedence in "Source of truth"
above.

`DELETE /api/slack/mappings/override/:accountId` clears the override
entirely (URL + channel id nulled out) and re-runs single-account
precedence resolution. Use the **Clear override** button on rows whose
`source` is `override`.

All set/clear actions write `slack.mapping.override.set` /
`slack.mapping.override.clear` rows to `audit_log` with actor and
validation outcome.

### How the hard send toggle works

Implemented in `packages/slack-send/src/gate.ts`. Three independent
guards. ALL must pass for a real send; ANY failing one blocks:

```
SLACK_READ_ONLY_MODE  Phase-1a kill switch. When "true", ALL sends are
                      blocked regardless of any other config. Default off
                      in code; ON in .env.example for new clones.
ENABLE_SLACK_SEND     Master send toggle. Must be the literal "true".
SLACK_BOT_TOKEN       xoxb-… bot token. User tokens (xoxp-) and browser-
                      session tokens (xoxc-) are HARD-REJECTED for sends —
                      they would post as the human personally. Both can
                      still be used for read-only API calls (see below).
```

`assertSendEnabled()` throws `SendDisabledError` ("fails closed") on
any guard failure, with a distinct error code per guard for unambiguous
audit logs (`read-only-mode`, `send-disabled`, `no-bot-token`,
`no-test-recipient`). The check is re-run at confirm time so flipping
the env mid-session immediately blocks the next confirm.

Preview is **never** gated: previews are pure rendering, do not call
Slack, and are explicitly allowed when sending is off so the operator
can see what *would* be sent.

There is no bulk-send path. `postMessage()` accepts one channel and one
text body; the API routes accept exactly one `accountId` per preview
and one `previewId` per confirm. The type signature does not admit a
list.

### How test-to-self works

Set `SLACK_TEST_USER_ID` to a Slack user id (Uxxx) or a pre-opened DM
channel id (Dxxx). The "Preview → test-to-self" button in `/admin/slack`
routes the message to that id instead of the customer channel, prefixed
with `[TEST MODE — redirected from customer channel] ` so it's
unmistakable in the recipient's DM. Test-to-self:

- still requires `ENABLE_SLACK_SEND=true` and a bot token,
- still requires explicit per-message confirmation,
- works even when a customer mapping is missing or invalid,
- writes audit rows with `mode='test_to_self'` so the redirect is
  permanently visible in `slack_message_audit`.

### Read-only auth for mapping (`auth.test`, `conversations.list`, `conversations.info`)

Three options, in precedence order. The gate resolves to the first
configured option:

#### 1. Bot token (`SLACK_BOT_TOKEN`, xoxb-) — best, requires admin

Create a Slack app in the Zuora workspace with bot scope `channels:read`
(plus `chat:write`, `users:read` for phase 1b sends), install to the
workspace. Zuora's enterprise policy requires admin approval for app
installs. This is the only option that survives operator turnover and
runs in CI/shared deployments.

#### 2. User token (`SLACK_USER_TOKEN`, xoxp-) — middle ground

Same Slack app, but `channels:read` added under **User Token Scopes**
instead of Bot Token Scopes. Sometimes self-installs without admin
approval; in Zuora's workspace currently does NOT (admin approval
required for all OAuth scopes). Read-only — `chat.postMessage` is
hard-rejected by the gate.

#### 3. Browser-session token (`SLACK_XOXC_TOKEN` + `SLACK_XOXD_COOKIE`) — last resort

Scraped from your own logged-in Slack web client. Use ONLY when admin
approval blocks the other two paths and you need read-only mapping for
an MVP demo. **Read all caveats in `.env.example` before enabling.**
Hard-rejected by the gate for `chat.postMessage`. Cookie rotates on
session refresh (every few hours on SSO) — see "Refreshing the xoxc
cookie" below.

The web app refuses to boot under `SLACK_XOXC_TOKEN` if `.env` is
git-tracked or `.gitignore` is missing entries for `.env.*` (see
`apps/web/src/lib/xoxc-safety.ts`). xoxc API calls are rate-limited
to ~250ms cadence so the traffic pattern looks closer to a web client
than to a scraper.

### Refreshing the xoxc cookie (when using option 3)

The `d` cookie that Slack pairs with the xoxc token expires on session
refresh — typically every few hours on SSO setups. You'll know it
expired when:

- `/admin/slack` → **Verify Slack token** returns `invalid_auth`, OR
- A mapping refresh's response contains `validationErrors > 0`, OR
- Server logs show `401` from `slack.com/api/*`.

To rotate (≈60 seconds end-to-end):

1. **Sign back into Slack web** at https://zuora.enterprise.slack.com.
   If you're already in, no action needed — the cookie is automatically
   fresh in the browser; we just need to re-copy it.
2. **DevTools → Network**. Clear (🚫 icon). Filter box: `slack.com/api/`.
   In the request-type row click **Fetch/XHR**.
3. **Click around in Slack** (switch a channel, scroll history) to
   generate a `/api/` request. Right-click any POST row → **Copy** →
   **Copy as cURL**.
4. **In a terminal at the repo root:**
   ```bash
   mkdir -p ~/tmp && pbpaste > ~/tmp/slack_curl.txt && python3 - <<'PYEOF'
   import re, pathlib
   src = pathlib.Path.home().joinpath('tmp/slack_curl.txt')
   env = pathlib.Path('.env')
   s = src.read_text()
   tok = re.search(r'xoxc-[A-Za-z0-9-]+', s)
   ck = re.search(r"d=xoxd-[^;\s'\"]+", s)
   if not tok or not ck:
       raise SystemExit('Could not find xoxc-token or d= cookie in clipboard. Re-copy a POST request as cURL.')
   tok, ck = tok.group(0), ck.group(0)[2:]  # strip 'd='
   cur = env.read_text()
   lines = [l for l in cur.splitlines() if not l.startswith(('SLACK_XOXC_TOKEN=', 'SLACK_XOXD_COOKIE='))]
   lines += [f'SLACK_XOXC_TOKEN={tok}', f'SLACK_XOXD_COOKIE={ck}']
   env.write_text('\n'.join(lines) + '\n')
   src.unlink()
   print(f'OK — .env updated. token_len={len(tok)} cookie_len={len(ck)}')
   PYEOF
   ```
5. **Restart `next dev`** so the new env is picked up. Next 14 only
   auto-loads `apps/web/.env*`, not the monorepo root, so the
   restart command must export `.env` explicitly:
   ```bash
   pkill -f 'next dev'
   set -a && source .env && set +a && npm run dev --workspace apps/web
   ```
6. **Verify**: `curl -sS http://localhost:3000/api/slack/auth-test` →
   should return `"ok": true`, `"tokenKind": "xoxc"`.

If `auth-test` returns `invalid_auth` immediately after rotation, the
most common cause is that the cookie copy included a leading `d=` or
trailing `;` — re-check the value in `.env` starts cleanly with
`xoxd-` and has no surrounding whitespace.

A future hardening (deliberately not built — see "intentionally NOT
built" below) is a Playwright-driven `slack:refresh` script that does
this dance headlessly on a cron. Skipped for now because (a) it
escalates the TOS posture from "manually using your browser session"
to "automating your browser session" and (b) it doesn't help once you
have a real bot token, which is the actual fix.

### How to enable real sending safely (phase 1b)

Phase 1a (read-only mapping) is what's currently shipped. To advance to
phase 1b (sending):

1. Create a Slack bot user in the Zuora workspace, install it (admin
   approval required), copy the `xoxb-…` token.
2. Invite the bot to the customer channel(s) you intend to send to.
   (We deliberately do NOT request `chat:write.public`, which would let
   the bot post in any public channel without being invited.)
3. In `.env`:
   ```
   SLACK_READ_ONLY_MODE=false   # or remove the line entirely
   ENABLE_SLACK_SEND=true
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_TEST_USER_ID=U01234567   # your own user id; used for test-to-self
   ```
4. Restart the web app.
5. Use `/admin/slack`: refresh mappings → select one account →
   compose → **Preview → test-to-self** first (delivers to your DM) →
   confirm once you're happy → then repeat with **Preview → customer
   channel** for the real send.

### Audit trail

- High-level events in the existing `audit_log` table (visible on the
  `/admin/refresh` page): `slack.mapping.refresh.{start,complete}`,
  `slack.send.{preview,sent,blocked,cancelled,failed}`.
- Per-message detail in the new `slack_message_audit` table: every
  preview, confirm, send, cancel, block, failure. Confirm rows carry
  `preview_of` pointing at the preview row (enforces no-reuse-of-
  confirmation across messages).

### What is intentionally NOT built

- No bulk / batch send. Single-target only.
- No background or scheduled auto-send.
- No automatic Slack channel creation.
- No automatic Slack API validation of *every* mapping on every refresh
  (would be rate-limit heavy and unnecessary). Refresh validates the
  unvalidated tail at 40 channels/run, sticky on terminal states, with
  a 24h "recently validated live" skip so the budget rotates.
- No silent fallback from customer channel to anywhere except the
  explicitly user-selected test-to-self destination.
- No `chat:write.public` scope (would let the bot post in any public
  channel without being invited — too wide).
- No headless Playwright cookie refresher for xoxc. Manual rotation
  procedure above is intentional: automating the browser-session scrape
  escalates the TOS posture, and the right answer is to get a real bot
  token, not to make the workaround more permanent.

## Out of scope for v0

Multi-user auth, FLM Notes writeback, real-time push, broader
Slack/email notification fan-out, mobile views, direct Cerebro API
(does not exist), direct Staircase API (no connector), local Zuora MCP
(Remote only), and any tool that writes to any system other than the
single-target Slack send path above (which is gated by
`ENABLE_SLACK_SEND` and audited end-to-end).
