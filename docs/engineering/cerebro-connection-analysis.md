# Cerebro Connection Analysis (MDAS)

**Date:** 2026-06-15  
**Status:** Working notes — architecture reconnaissance + capability discovery  
**Owner:** MDAS engineering

---

## 1. MDAS architecture findings

| Layer | Choice | Evidence |
|---|---|---|
| Monorepo | npm workspaces | `package.json` |
| Language | TypeScript 5.4 strict | `tsconfig.base.json` |
| Web | Next.js 14 App Router, React 18, Tailwind | `apps/web/package.json` |
| Worker | Node + tsx, Postgres queue | `apps/worker/` |
| DB | Postgres 16, JSONB snapshots | `packages/db/` |
| Tests | vitest 1.5 | `vitest.config.ts`, `npm test` |
| Lint/typecheck | `tsc -b --pretty` (no ESLint) | `npm run lint` |
| CI | GitHub Actions: ci-guard → tsc → vitest → build | `.github/workflows/ci.yml` |

**Integration model:** MDAS does not have a generic “connection registry” UI. External systems integrate as **`ReadAdapter`** implementations under `packages/adapters/read/*`, opt-in via `ADAPTER_*=real` env flags, orchestrated by `apps/worker/src/orchestrate.ts`.

**Read-only invariant:** No `adapters/write/`; `readOnlyGuard()` on outbound HTTP; `mcp.config.json` tool allowlist; CI `scripts/ci-guard.mjs`.

**Merge policy:** `localSnapshots → cerebro → gainsight → glean-mcp → staircase → zuora-mcp → salesforce` (last-write-wins on shared fields; Salesforce wins).

---

## 2. Existing connection / data-source abstractions

| Concept | Location | Notes |
|---|---|---|
| `ReadAdapter` contract | `packages/canonical/src/index.ts` | `fetch()`, optional `healthCheck()`, `isReadOnly: true` |
| `RefreshContext` | same | logger, priorRun, reportProgress, asOf |
| HTTP guard | `packages/adapters/read/_shared/src/index.ts` | `readOnlyGuard`, `RateLimiter` |
| Glean MCP client | `packages/adapters/read/_shared/src/glean.ts` | Streamable HTTP JSON-RPC; pattern for MCP transport |
| Adapter registration | `apps/worker/src/orchestrate.ts` | `REAL_ADAPTERS` + `selectActiveAdapters()` |
| Per-source freshness | `CanonicalAccount.lastFetchedFromSource` | keyed by `AdapterSource` |
| Admin diagnostics | `/admin/refresh` | per-source freshness from snapshots; worker startup health probes |
| MCP allowlist | `mcp.config.json` | repo-level, CI-enforced |

**No OpenAPI codegen** exists in MDAS today. Typed clients are hand-written (see `salesforce/src/client.ts`, `glean.ts`).

---

## 3. Files / classes to extend

| Purpose | File / package |
|---|---|
| New primary Cerebro REST adapter | `packages/adapters/read/cerebro-rest/` (new) |
| Glean fallback (existing) | `packages/adapters/read/cerebro-glean/` |
| Orchestrator registration | `apps/worker/src/orchestrate.ts` |
| HTTP allowlist | `packages/adapters/read/_shared/src/index.ts` |
| Canonical Cerebro fields | `packages/canonical/src/index.ts` (`cerebroRisks`, `cerebroRiskCategory`, …) |
| MCP allowlist | `mcp.config.json` |
| Env template | `.env.example` |
| Integration docs | `docs/integrations/cerebro.md` |
| Scoring consumer | `packages/scoring/src/risk-score.ts` |

---

## 4. Most similar existing connector

**`cerebro-glean`** — same domain (Cerebro health risk → `CanonicalAccount`), same merge key (`salesforceAccountId`), same per-account enrichment loop, freshness skip via `isFreshEnoughToSkip`, concurrency pattern.

**Secondary pattern:** **`zuora-mcp`** — Zuora-hosted MCP with OAuth; MDAS only stubs health. Cerebro REST is closer to **`salesforce`** (deterministic REST + bearer/token auth + hand-typed client).

**Why cerebro-glean is insufficient alone:** Glean’s `app:cerebro` index omits **Risk Category** and **Risk Analysis** (verified 2026-04-28). Direct Cerebro REST (via Cerebro Engage API token) is the intended production path per Corporate Data’s `cerebro-api` SKILL.md (Slack `#cerebro-mcp`, Karl Goldstein, 2026-06-03).

---

## 5. Auth pattern to reuse

| Transport | Auth | MDAS pattern |
|---|---|---|
| **REST (production)** | `Authorization: Bearer $CEREBRO_API_TOKEN` from **Cerebro Engage → Settings → API Tokens** | Same as `GLEAN_MCP_TOKEN`: env var, never logged, return empty adapter when missing |
| **MCP (discovery / IDE)** | OAuth 2.0 authorization code via Cerebro Engage on first Cursor connection | **Not** wired into worker runtime; configure in user `~/.cursor/mcp.json` |

**OAuth metadata (unauthenticated probe, 2026-06-15):**

- MCP endpoint: `https://cerebro-mcp.corpdata.zuora.com/mcp`
- Protected resource: `https://cerebro-mcp.corpdata.zuora.com/.well-known/oauth-protected-resource/mcp`
- Authorization server: `https://cerebro.corpdata.zuora.com/`
- Token endpoint: `https://cerebro.corpdata.zuora.com/api/oauth/token`
- Registration: `https://cerebro.corpdata.zuora.com/api/oauth/register`
- Scopes: `mcp:tools`, `mcp:resources`

**Corporate access:** Zscaler group `AMG-Zscaler-Cerebro` (Confluence: [Cerebro Corporate Data Warehouse](https://zuora-it.atlassian.net/wiki/spaces/IT/pages/2287599617)).

---

## 6. Sync / fetch pattern to reuse

MDAS does **full refresh**, not incremental sync:

1. Worker prefetches prior snapshot (`ctx.priorRun`)
2. Adapter loops accounts with bounded concurrency
3. Per-account freshness skip (`GLEAN_FRESHNESS_HOURS` / `FORCE_REFRESH`)
4. Returns `Partial<AdapterFetchResult>` merged by orchestrator
5. Stamps `lastFetchedFromSource.cerebro`

**Cerebro REST adapter** follows the same loop as `cerebro-glean`, replacing per-account Glean search with batched `POST /api/accounts/details` (OpenAPI `get_account_details`; up to 10 Salesforce IDs per request). Maps `customerState.risks` → Risk Category / Risk Analysis and `customerState.healthRisks` → the 7 boolean signals.

---

## 7. Test pattern to reuse

- vitest unit tests colocated: `*.test.ts`
- Mock `global.fetch` (see `glean.test.ts`, `salesforce/client.test.ts`)
- Sanitized fixtures in `src/fixtures/`
- No live corp calls in CI

---

## 8. UI / config registration pattern

- **Config:** `.env.example` + `ADAPTER_CEREBRO=real`
- **Health:** adapter `healthCheck()` probed at worker startup (`apps/worker/src/main.ts`)
- **Freshness UI:** `/admin/refresh` via `getPerSourceFreshness()`
- **No connection setup wizard** — env-driven only (consistent with Salesforce/Glean)

---

## 9. Known constraints and risks

| Risk | Mitigation |
|---|---|
| No Cerebro Engage access | Document requirement; adapter no-ops; Glean fallback remains |
| Token show-once / rotation | Clear error messages; healthCheck surfaces 401 |
| VPN / Zscaler | Document corp network; same as Glean worker TLS notes |
| Permission variance | Do not assume all users see all accounts; respect 403 |
| OpenAPI behind auth | Runtime fetch `/api/guide/api`; ship minimal fixture subset for tests |
| SSRF via custom base URL | Allowlist `*.corpdata.zuora.com` and `localhost` for dev |
| Schema drift | Capability discovery + `/docs` drift monitor (follow-up) |
| MCP tool names unknown without auth | Document IDE-only discovery; do not depend on MCP in worker |

---

## 10. Cerebro capability discovery

### 10.1 What Cerebro is (product terms)

Zuora **Cerebro** is Corporate Data’s customer intelligence platform:

| Domain | Examples |
|---|---|
| **Health risk** | 7 risk booleans, utilization/share/engagement metrics, product attach flags |
| **Risk category / analysis** | Low/Medium/High/Critical + prose (direct source / NASE sheet — **not** in Glean index) |
| **Cerebro Engage** | Catalysts (expansion signals), account pages, deep links |
| **Deep links** | `https://cerebro.na.zuora.com/salesforce/accounts/{sfid}/health`, `https://cerebro.corpdata.zuora.com/account/{id}/catalysts` |

**Questions it answers:** Which accounts have utilization/engagement/pricing risk? What are sub-metrics (PBU, exec meetings, API usage)? What expansion catalysts exist?

**Freshness:** Glean `updateTime` on healthrisk docs; Cerebro pages refresh ~weekly.

**Permissions:** Cerebro Engage login + API token scopes; MCP OAuth user-scoped.

### 10.2 MCP discovery (2026-06-15)

**Endpoint:** `https://cerebro-mcp.corpdata.zuora.com/mcp`  
**Server:** uvicorn (FastAPI)  
**Unauthenticated behavior:** HTTP 401, `WWW-Authenticate: Bearer`, prompts MCP client re-register via OAuth.

**Could not enumerate tools/resources/prompts** without Cerebro Engage OAuth session in this environment.

**Expected MCP capabilities (inferred from REST + Engage Glean index):**

| Inferred tool class | Purpose | MDAS use |
|---|---|---|
| Account health lookup | SFDC ID → health risk record | Primary enrichment |
| Account / catalyst search | Engage signals | Future upsell intel |
| Guide / schema | `/api/guide` companion | Capability browser |

**MCP vs REST default:** REST for worker; MCP for Cursor discovery only.

**Cursor config** (user-level `~/.cursor/mcp.json`, not committed):

```json
"zuora-cerebro": {
  "url": "https://cerebro-mcp.corpdata.zuora.com/mcp"
}
```

On first connect, Cursor completes Cerebro Engage OAuth. **Requires Cerebro Engage access.**

### 10.3 REST / OpenAPI discovery (2026-06-15)

| Path | HTTP | Notes |
|---|---|---|
| `/api/whoami` | 401 without token | Auth validation; returns `email`, `scopes`, `clientId: "api-token"` |
| `/api/guide/api` | 401 | **Canonical REST guide** (dynamic JSON `guide` field) |
| `/api/guide` | 401 | MCP tool vocabulary / shared filters |
| `/docs` | 401 | Interactive OpenAPI (always current per SKILL.md) |
| `/api/openapi.json` | 401 | OpenAPI spec exists, auth-gated |
| `/openapi.json` | 401 | Same |

**Bootstrap (from Corporate Data SKILL.md, Slack `#cerebro-mcp`, 2026-06-03):**

```bash
export CEREBRO_BASE_URL="https://cerebro-mcp.corpdata.zuora.com"
export CEREBRO_API_TOKEN="..."  # Cerebro Engage → Settings → API Tokens
curl -s -H "Authorization: Bearer $CEREBRO_API_TOKEN" "$CEREBRO_BASE_URL/api/whoami"
curl -s -H "Authorization: Bearer $CEREBRO_API_TOKEN" "$CEREBRO_BASE_URL/api/guide/api"
```

**Health risk REST path:** `POST /api/accounts/details` with `{ "salesforceAccountIds": ["…"] }` — returns `customerState.risks` (Risk Category, Risk Analysis) and `customerState.healthRisks` (7 signals). Deep link UI remains `https://cerebro.na.zuora.com/salesforce/accounts/{sfid}/health`.

### 10.4 MCP vs REST comparison

| Aspect | MCP | REST |
|---|---|---|
| Auth | OAuth on first IDE connect | Long-lived Engage API token |
| Production MDAS worker | **Not recommended** | **Recommended** |
| Capability docs | `GET /api/guide` | `GET /api/guide/api` |
| OpenAPI | Via MCP metadata | `/docs`, `/api/openapi.json` |
| Deterministic CI | Hard (OAuth) | Easy (mock fetch) |
| Agent / IDE use | Excellent | Good via typed client |

---

## 11. Existing MDAS feature impact

| Feature | Location | Cerebro REST plug-in | Changes |
|---|---|---|---|
| Cerebro enrichment | `cerebro-glean` | Primary when `CEREBRO_API_TOKEN` set | New `cerebro-rest` adapter runs first |
| Risk Category passthrough | `scoring/risk-score.ts` | REST may supply category/analysis | Mapper sets `cerebroRiskCategory` when present |
| Account drill-in | `/accounts/[id]` | Richer data + deep links | None (reads snapshots) |
| Forecast Key Saves chips | `forecast-generator` | Better Risk Category in chips | Automatic once snapshot populated |
| Admin freshness | `/admin/refresh` | Same `cerebro` source key | healthCheck diagnostics |
| Glean fallback | `cerebro-glean` | Fills gaps when REST creds missing | Keep unchanged |

---

## 12. New feature opportunities (prioritized)

| Feature | User value | Cerebro capability | MVP |
|---|---|---|---|
| Direct REST enrichment | Accurate Risk Category + analysis | `/api/.../health` | **This PR** |
| Capability browser | Admin visibility into endpoints | `/api/guide`, `/docs` | healthCheck metadata |
| Customer intelligence panel | Catalysts on account page | Engage catalysts API | Follow-up |
| NL Cerebro query | Business questions | search/chat tools (MCP) | IDE-only first |
| Schema drift monitor | Breaking API alerts | OpenAPI diff | Follow-up |

---

## 13. Implementation design (summary)

See `packages/adapters/read/cerebro-rest/` for:

- `CerebroRestClient` — typed GET client, retry on 429/5xx (idempotent GETs only)
- `runCerebroConnectionTest` — structured diagnostics
- `mapCerebroCapabilities` — normalized capability model
- `cerebroRestAdapter` — `ReadAdapter` with Glean-compatible enrichment loop
- Tests with mocked fetch + sanitized fixtures

**Rollout:** `ADAPTER_CEREBRO=real` + `CEREBRO_API_TOKEN`. Glean path remains when token absent. Feature flag: presence of token (no separate flag needed).

**Env vars:**

```
CEREBRO_API_TOKEN=          # Cerebro Engage API token (required for REST)
CEREBRO_BASE_URL=https://cerebro-mcp.corpdata.zuora.com
ADAPTER_CEREBRO=real
```

---

## 14. References

- [Cerebro integration (MDAS)](../integrations/cerebro.md)
- [Repo map (audit)](../audit/00_repo_map.md)
- Corporate Data `cerebro-api` SKILL.md — Slack `#cerebro-mcp`, 2026-06-03 (via Glean)
- [Cerebro Corporate Data Warehouse](https://zuora-it.atlassian.net/wiki/spaces/IT/pages/2287599617) — Confluence, 2026-05-21
