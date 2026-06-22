# Renewal Performance Metrics

Technical design for the Expand 3 CSE Renewal Manager dashboard (`/renewals`).

## Data sources

| Metric input | Canonical field | SFDC source |
|--------------|-----------------|-------------|
| ATR | `availableToRenewUSD` | `Available_to_Renew_USD__c` (+ fallbacks) |
| Closed renewed $ | `acv`, `acvDelta` | `ACV__c`, `fml_DerivedACVDelta_USD__c` |
| Open forecast $ | `forecastMostLikelyOverride`, `forecastMostLikely` | Manager override / rep ML |
| Full churn signal | churn notice dates, closed lost | notice fields, `StageName` |
| Known churn (excluded) | `churnRisk` | `Churn_Risk__c` = `Confirmed Full Churn` |
| Reason | `churnDownsellReason`, account `churnReason` | `Churn_Downsell_Reason__c`, `Churn_Reason__c` |
| Health proxy | `AccountView.riskScore` | Composite from Cerebro + SFDC |

**There is no dedicated renewed-revenue SFDC field.** Renewed revenue is derived in `@mdas/renewal-metrics` using the same signed-delta conventions as `@mdas/forecast-generator`.

## Metric definitions

### ATR up for renewal
Sum of `availableToRenewUSD` on **renewal-type** opportunities (`type` contains "Renewal") whose `closeDate` falls in the selected fiscal quarter(s). **Excludes** opps with `Churn_Risk__c = Confirmed Full Churn` (see Known churn). Accounts without positive ATR on in-scope renewal opps are excluded.

### Known churn (separate track)
Renewal opps with SFDC **Churn Risk = Confirmed Full Churn** are **excluded from all saveable renewal KPIs** (ATR, GRR, churn, downsell, bridge, outcome counts). They are summarized separately:

| Field | Definition |
|-------|------------|
| `accountCount` | Distinct accounts with ≥1 confirmed-full-churn renewal opp in scope |
| `opportunityCount` | Confirmed-full-churn renewal opps in scope |
| `atrUSD` | Sum of `availableToRenewUSD` on those opps |
| `knownChurnUSD` | Sum of `Known_Churn_USD__c` on those opps (informational only) |

Dashboard: dedicated **Known churn** card on `/renewals`. Analysis: KPI tile + opp-level drilldown on `/renewal-analysis?knownChurn=1`.

### Renewed revenue (derived)
Per **saveable** renewal opportunity (not known churn):

1. **Full churn** → `0` when churn notice dates set, closed lost, or confirmed churn on closed opp.
2. **Closed won** → when `acv ≈ acvDelta`, use `ATR + acvDelta` (SFDC duplicates delta into ACV); else use `acv` when it is a plausible post-renewal total.
3. **Open / forecast** → `max(0, ATR + managerML)` where manager ML override wins over rep ML (signed delta, negative = loss).

Account rows aggregate multiple renewal opps in the same period (multi-subscription safe).

### ATR churned
Sum of ATR where account/opp outcome is **full churn** (`renewedRevenue = 0`, ATR > 0) on the **saveable book**. Includes **closed-lost** renewals after close. Excludes SFDC `Churn_Risk__c = Confirmed Full Churn` (see Known churn). Churn-notice-submitted dates alone do **not** count as full churn.

### Full logo churn rate
`full_churn_accounts / accounts_up_for_renewal` on the saveable book (closed-lost outcomes). SFDC **Confirmed Full Churn** opps (`Churn_Risk__c`, usually `Sub_type__c = Full Churn`) are in the **Known churn** card, not this numerator.

### Downsell account rate
Accounts with `0 < renewed < ATR` divided by accounts up for renewal. Downsell amount = `ATR − renewed` on those accounts.

### Gross revenue retention (GRR)
`sum(renewedRevenue) / sum(ATR)`. Expansion on renewal lines is included in the numerator when renewed > ATR.

### Renewal outcomes
| Outcome | Rule |
|---------|------|
| `full_churn` | SFDC `Churn_Risk__c = Confirmed Full Churn` (Known churn track), or closed-lost with renewed = 0 |
| `downsell` | 0 < renewed < ATR |
| `flat` | renewed ≈ ATR |
| `expanded` | renewed > ATR |
| `pending` | Open, close date not passed |
| `pushed` | Open, close date passed |

Churn and downsell are mutually exclusive at the **account** level after opp roll-up.

## Edge cases

| Scenario | Treatment |
|----------|-----------|
| Multiple renewal opps same quarter | Sum ATR and renewed at account level |
| Non-renewal opps (Amendment, Upsell) | Excluded from renewal metrics |
| Zero ATR renewal opp | Excluded unless full-churn signal present |
| Known churn opp (`Churn_Risk__c = Confirmed Full Churn`) | Excluded from saveable metrics; tracked in `knownChurn` summary |
| Manager ML override | Authoritative for open forecast path |
| Positive ML on renewal | Treated as signed delta: `ATR + ML` |
| Clari CSV | Not used on this dashboard (MDAS snapshot only) |
| Currency | USD fields only; no FX normalization |

## UI

Route: `/renewals` — **Renewal Scorecard** (executive summary, trends, plan vs flash).

Route: `/renewal-analysis` — **Renewal Workbench** (operational drill-down: forward pipeline + quarter-close review). Both share one nav item ("Renewals") with Scorecard / Workbench tabs — not two separate top-level destinations.

### Quarter buckets (app-wide)

Every fiscal quarter belongs to **exactly one bucket** — buckets are contiguous and never overlap. The current (in-progress) quarter is **prospective-only** so a quarter is never split across both lenses.

| Bucket | Window | Size |
|--------|--------|------|
| **Retrospective** | The most recently completed quarters (excludes current) | `FISCAL_QUARTER_RETROSPECTIVE_COUNT = 8` |
| **Prospective** | Current quarter + next 7 | `FISCAL_QUARTER_PROSPECTIVE_COUNT = 8` |

Implemented in [apps/web/src/lib/fiscal.ts](apps/web/src/lib/fiscal.ts): `fiscalQuarterRetrospectiveOptions`, `fiscalQuarterProspectiveOptions`, `bucketQuarterKeys`, `isRetrospectiveQuarterKey`, `isProspectiveQuarterKey`, `scopeQuartersToBucket`, `resolveQuarterBucket`.

The data-pull / close-date horizon (`FISCAL_QUARTER_FORWARD_COUNT`, current + 8) is intentionally a superset of the selectable prospective window so the worker pull is unaffected.

**Selector** ([apps/web/src/components/FiscalQuarterFilter.tsx](apps/web/src/components/FiscalQuarterFilter.tsx)): a Retrospective / Prospective toggle (URL `?bucket=`) shown on every page via the `defaultBucket` prop; the quarter menu only ever lists the active bucket's 8 quarters. Default bucket per page: prospective for `/`, `/accounts`, `/opportunities`, `/hygiene`; retrospective for `/wow`, `/renewals`. On `/renewal-analysis` the bucket is pinned by the view tabs (Pipeline = prospective, Quarter close = retrospective) so the toggle is hidden. Switching bucket/view resets the quarter selection to that bucket so past and future are never mixed.
- Open pipeline ATR, pushed renewals, at-risk (Cerebro Critical/High), renewals next 30 days, total book ATR, known churn
- Drilldown shows **open renewals only** with Status (Open / Pushed), next step, and **Overall Assessment** (Cerebro category + hover narrative)
- Preset drilldown views: **By renewal date**, **By ATR**, **By health**
- Churn/downsell reason tables and outcome breakdown are hidden (not useful for forward management)

### Quarter close (retrospective)
- GRR, churn/downsell rates, revenue bridge, outcome breakdown (**closed outcomes only**)
- Top churn/downsell reasons (by ATR) — review after the quarter ends
- Drilldown includes Outcome, Renewed, Churned, Downsell, Reason columns

Overall Assessment maps to `cerebroRiskCategory` with `cerebroRiskAnalysis` on hover (from Cerebro REST/Glean indexing).

Reuses: `FiscalQuarterFilter`, `StatTile`, `Card`, `TableHeader`, `RiskScoreBadge`.

Prior-period comparison: when exactly one fiscal quarter is selected, KPIs compare to the immediately prior fiscal quarter.

## Validation checklist

Reconcile dashboard totals against Salesforce / Clari for each scenario:

- [ ] **Full churn period** — ATR churned = sum of ATR on closed-lost saveable renewals; logo churn rate matches manual account count (known churn excluded)
- [ ] **Known churn period** — Known churn card counts/ATR match opps with `Churn_Risk__c = Confirmed Full Churn`; those opps absent from GRR and saveable ATR
- [ ] **Downsell period** — Downsell $ = Σ(ATR − renewed) where renewed > 0; rate matches account count
- [ ] **Expansion period** — GRR > 100%; expansion bridge line matches Σ(renewed − ATR) on expanded accounts
- [ ] **Multi-subscription account** — Account row ATR = sum of opp ATR; renewed = sum of opp renewed
- [ ] **Multi renewal opp same account** — Same as above; outcome from aggregated dollars
- [ ] **Zero renewed revenue** — Classified full churn; appears in churn drilldown only
- [ ] **Renewed < ATR** — Downsell amount and % correct; not counted as churn
- [ ] **Renewed = ATR** — Outcome `flat`; zero churn and downsell dollars
- [ ] **Renewed > ATR** — Outcome `expanded`; GRR numerator includes expansion
- [ ] **KPI vs table** — Summary cards reconcile with drilldown row sums (automated test)

Suggested SOQL spot-check (adjust quarter filter):

```sql
SELECT Account.Name, Available_to_Renew_USD__c, ACV__c,
       Forecast_Most_Likely__c, Forecast_Most_Likely_Override__c,
       Churn_Risk__c, Known_Churn_USD__c, fml_DerivedACVDelta_USD__c, StageName, Type
FROM Opportunity
WHERE Type LIKE '%Renewal%'
  AND Current_FY_Franchise__c = 'Expand 3'
```

Compare a sample of 10 accounts manually against `/renewals` drilldown rows.

## Tests

- `packages/renewal-metrics/src/index.test.ts` — core metric edge cases and summary/drilldown reconciliation
