# Cerebro Integration

MDAS reads Cerebro health-risk data via Glean — Cerebro has no public REST API, so Glean's federated search is the only programmatic access path.

## Architecture

```
Cerebro web UI                       Cerebro Glean datasource
(no public API)         ───────►    (app:cerebro, type:healthrisk)
                                              │
                                              ▼
                                     packages/adapters/read/cerebro-glean
                                              │
                                              ▼
                                     CanonicalAccount.cerebroRisks
                                     CanonicalAccount.cerebroSubMetrics
```

## What Cerebro's Glean index exposes

Verified via `mcp2_search` and `mcp2_read_document` on 2026-04-28. Each Cerebro Health Risk page is one Glean document (`type: healthrisk`) with the following structured fields exposed via `richDocumentData.facets.keywordFacets` (canonical-cased) and `matchingFilters` (lowercase):

**Identity**
- `crSalesforceAccountId` — primary join key into `snapshot_account.account_id`
- `crCustomerName` — for cross-checking the SFDC `Account.Name`

**The 7 risk booleans** (mapped to `CanonicalAccount.cerebroRisks`)
- `crEngagementRisk`
- `crExpertiseRisk`
- `crLegacyTechRisk`
- `crPricingRisk`
- `crShareRisk`
- `crSuiteRisk`
- `crUtilizationRisk`

**Sub-metrics** (mapped to `CanonicalAccount.cerebroSubMetrics`, via `richDocumentData.facets.intFacets`)
- `crProjectedBillingUtilization` (%)
- `crProjectedRevenueUtilization` (%)
- `crExecutiveMeetingCount`
- `crBillingProductShare` / `crRevenueProductShare` (%)
- `crOrdersApiUsage` (%)
- `crEmailedInvoices`, `crEpaymentsProcessed`, `crInvoicesPosted`, `crJournalEntries`, `crOrders`, `crQuotes`
- `crRevenueAmount`, `crBillingCost`, `crRevenueCost`, `crDso`

**Has-flags** (mapped into `cerebroSubMetrics` as booleans)
- `crHasEnhancedServices`, `crHasEsa`, `crHasInvoiceSettlement`, `crHasMs`, `crHasPes`, `crHasTam`, `crHasUno`, `crReportingUse`

**Freshness**
- `updateTime` on the Glean document — surfaced as `lastFetchedFromSource.cerebro` and renderable as a "Cerebro indexed at" pill on the Account Drill-In (PR-5).

## What Cerebro's Glean index does NOT expose

> **Risk Category** (`Low` / `Medium` / `High` / `Critical`) and **Risk Analysis** (the prose paragraph describing why a customer is at risk) — verified absent from `app:cerebro` documents in both `search` and `read_document` responses.

These two fields appear to live in a curated weekly Google Sheet (`Cerebro Accounts with NASE`) that a separate process generates. **MDAS does not read from this sheet today.** Risk Category passthrough therefore activates the scoring layer's documented fallback path:

```ts
// packages/canonical/src/index.ts
export interface RiskIdentifier {
  level: CerebroRiskCategory | 'Unknown';
  source: 'cerebro' | 'fallback';   // ◄ 'fallback' until a sheet adapter lands
  rationale: string;
}
```

Per Section 10 of the refactor prompt: *"Risk Category is a direct passthrough from Cerebro... The fallback (when Cerebro data is missing) is the only place a derivation happens."* The current behavior is consistent with that rule — the Cerebro Glean index simply does not carry the value.

### Future work (PR-4.b, awaiting decision)

A Google-Sheet adapter (`packages/adapters/read/cerebro-sheet`) would:
1. Read the canonical "Cerebro Accounts with NASE" sheet via Glean's gdrive datasource
2. Parse `Risk Category` (column) and `Risk Analysis` (column) verbatim, keyed by SFDC Account ID
3. Populate `CanonicalAccount.cerebroRiskCategory` and `cerebroRiskAnalysis` directly
4. Emit a `SourceLink { source: 'cerebro', label: 'Risk Analysis (NASE export)', url: <sheet>, citationId, snippetIndex }`

This is deferred until you confirm: (a) the canonical sheet URL, (b) refresh cadence, (c) whether the data is published-readable to the worker's Glean credentials.

## Auth + rate limits

Same Glean credentials as the rest of the integration:

| Env var | Value |
|---|---|
| `GLEAN_MCP_TOKEN` | Bearer token |
| `GLEAN_MCP_BASE_URL` | e.g., `https://api.glean.com` |

Glean rate limits are not formally documented to MDAS; the GleanClient maintains an in-memory per-refresh cache (`docCache`) so that re-fetching the same Cerebro doc within a single refresh is free. Adapters share a single `GleanClient` instance per refresh via the planned `RefreshContext.glean` slot (see PR-5).

## Read-only invariant

The GleanClient at `packages/adapters/read/_shared/src/glean.ts` exposes only `search`, `searchAll`, `getDocuments`, and `healthCheck`. No write methods. All POSTs route through `readOnlyGuard` which only permits Glean's `search`, `chat`, `getdocument`, and `documents` paths. CI guard `scripts/ci-guard.mjs` check #4 greps adapter source for any `glean_(create|update|delete|post|send|upsert)_*` patterns; none exist today.

## Activation

```bash
echo "ADAPTER_CEREBRO=real" >> .env
echo "GLEAN_MCP_TOKEN=..." >> .env
echo "GLEAN_MCP_BASE_URL=https://api.glean.com" >> .env
docker compose up -d --build worker
```

Trigger a refresh, then verify in Postgres:

```sql
SELECT account_id,
       payload->'cerebroRisks',
       payload->'cerebroSubMetrics'->>'crProjectedBillingUtilization',
       payload->'lastFetchedFromSource'->>'cerebro'
  FROM snapshot_account
 WHERE refresh_id = (SELECT id FROM refresh_runs WHERE status='success' ORDER BY started_at DESC LIMIT 1)
   AND payload->'lastFetchedFromSource' ? 'cerebro'
 LIMIT 5;
```
