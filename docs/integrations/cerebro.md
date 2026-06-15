# Cerebro Integration

MDAS enriches accounts with Cerebro health-risk data using a **direct REST adapter** when a Cerebro Engage API token is configured, with **Glean federated search** as fallback.

## Architecture

```
Cerebro Engage API token          Glean MCP (fallback)
        │                                  │
        ▼                                  ▼
packages/adapters/read/cerebro-rest   packages/adapters/read/cerebro-glean
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
              CanonicalAccount.cerebroRisks
              CanonicalAccount.cerebroRiskCategory  ← REST may populate
              CanonicalAccount.cerebroRiskAnalysis    ← REST may populate
              CanonicalAccount.cerebroSubMetrics
```

When `ADAPTER_CEREBRO=real`:

1. **`cerebro-rest`** runs first if `CEREBRO_API_TOKEN` is set (production path).
2. **`cerebro-glean`** runs second; fills gaps when REST creds are missing or per-account REST 404.

See also: [Cerebro connection analysis](../engineering/cerebro-connection-analysis.md).

## Required access

| Requirement | Notes |
|---|---|
| **Cerebro Engage** | Web UI + API token minting at `/settings/api-tokens` |
| **Corp network** | VPN / Zscaler; group `AMG-Zscaler-Cerebro` for warehouse access |
| **API token** | Long-lived bearer; show-once at creation — store in secret manager / `.env` |

Without Cerebro Engage access, the REST adapter no-ops and Glean remains the only path (Risk Category / Analysis still absent from Glean index).

## Configuration

```bash
ADAPTER_CEREBRO=real
CEREBRO_API_TOKEN=...          # Cerebro Engage → Settings → API Tokens
CEREBRO_BASE_URL=https://cerebro-mcp.corpdata.zuora.com

# Fallback (when REST token absent or for gap-fill):
GLEAN_MCP_TOKEN=...
GLEAN_MCP_BASE_URL=https://api.glean.com
```

Verify REST auth:

```bash
curl -s -H "Authorization: Bearer $CEREBRO_API_TOKEN" \
  "$CEREBRO_BASE_URL/api/whoami"
```

Fetch live REST guide (endpoint shapes, pagination, errors):

```bash
curl -s -H "Authorization: Bearer $CEREBRO_API_TOKEN" \
  "$CEREBRO_BASE_URL/api/guide/api"
```

Interactive OpenAPI: `$CEREBRO_BASE_URL/docs`

## MCP (IDE / discovery only)

MCP endpoint: `https://cerebro-mcp.corpdata.zuora.com/mcp`

- Authenticates via **Cerebro Engage OAuth** on first Cursor connect.
- Use for tool/capability discovery — **not** used by the MDAS worker.
- Add to user `~/.cursor/mcp.json`:

```json
"zuora-cerebro": {
  "url": "https://cerebro-mcp.corpdata.zuora.com/mcp"
}
```

Repo allowlist: `mcp.config.json` → `zuora-cerebro` (empty tool list until authenticated discovery).

## What Cerebro REST exposes (health risk)

Mapped to `CanonicalAccount` by `packages/adapters/read/cerebro-rest/src/mapper.ts`:

**Risk category / analysis** (REST path — not in Glean index)

- `cerebroRiskCategory`: Low | Medium | High | Critical
- `cerebroRiskAnalysis`: prose paragraph

**Seven risk booleans** (`cerebroRisks`)

- Utilization, Engagement, Suite, Share, Legacy Tech, Expertise, Pricing

**Sub-metrics** (`cerebroSubMetrics`)

- PBU/PRU %, executive meeting count, product share %, API usage, invoice/ePayment counts, revenue amounts, has-flags (ESA, TAM, UNO, …)

**Provenance**

- `sourceLinks[]` with deep link to `cerebro.na.zuora.com/.../health`
- `lastFetchedFromSource.cerebro`

## Glean fallback limitations

Glean `app:cerebro` documents (`type:healthrisk`) omit Risk Category and Risk Analysis. When only Glean is available, scoring uses the **fallback** heuristic (`via fallback` badge in UI).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| REST adapter returns empty | No `CEREBRO_API_TOKEN` | Mint token in Cerebro Engage |
| `401` on whoami | Expired/invalid token | Re-mint token |
| `403` | Insufficient Engage permissions | Request access from Corporate Data |
| Network / TLS errors | VPN / Zscaler | Join `AMG-Zscaler-Cerebro`; see README corp TLS section |
| MCP won't connect in Cursor | No Cerebro Engage access | Complete Engage login / OAuth |
| Risk Category still `via fallback` | Only Glean path active | Set `CEREBRO_API_TOKEN` and re-refresh |

## Activation

```bash
echo "ADAPTER_CEREBRO=real" >> .env
echo "CEREBRO_API_TOKEN=..." >> .env
docker compose up -d --build worker
```

Worker startup runs `cerebro-rest` `healthCheck()` when the adapter is active.

## Read-only invariant

REST client uses GET only. `readOnlyGuard` allowlists `*.corpdata.zuora.com/api/*`. CI guard unchanged.
