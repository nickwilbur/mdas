# Glean Context Supplement — Existing MDAS Weekly Report

**Date:** 2026-06-26  
**Purpose:** Enterprise evidence cross-walk for CSE leadership briefing (complements `weekly-report-2026-06-26.md`)

---

## Glean Sources Reviewed (vetted)

| Source | URL | Updated | Authority | Confidence |
| ------ | --- | ------- | --------- | ---------- |
| Expand 3 Q3 Renewal Risk Mitigation Plan | [Google Doc](https://docs.google.com/document/d/1JdQY5uPM7kI_IH9QL1qGN3mN2UYVY-M71D24Lnd9vlM) | 2026-06-16 | Semi-official (CSE manager operational plan, Nick Wilbur) | **High** — directly names save motions, owners, deadlines |
| CSE Sentiment by Franchise | [Google Sheet](https://docs.google.com/spreadsheets/d/1oPGthvtSkG4dX3CAN5FnS8UXiY0e10GjaHtrl2GfBC8) | 2026-06-25 | Semi-official (CS ops reporting) | **High** — Expand 3 sentiment commentary source of truth |
| CSE MY SPIFF FY27 | [Google Sheet](https://docs.google.com/spreadsheets/d/1NdgHbV7MycLhH-KDSXMbH09-QxF3K_yONxYVKijXR9o) | 2026-06-26 | Semi-official (comp/ops) | **Medium** — renewal $ context, not retention rate |
| FY27 CSE ATR | [Google Sheet](https://docs.google.com/spreadsheets/d/1_17NSo3AibPt7OPWc5SeBABWg3OgZxweSdLpPkJvZCU) | 2026-04-06 | Semi-official (finance/ops quota) | **Medium** — Expand 3 Q3 ATR target $4.57M; stale >2 months |
| CSE Operational Cadence | [Google Slides](https://docs.google.com/presentation/d/189WqJslBasvsDi_6Vad8rLqo8nf5WjoICE_Xsn6XzG4) | 2026-01-26 | Official (CS enablement) | **Medium** — process norms; stale >6 months |

**Not found in Glean:** Board-level "10% ATR retention increase" target document. Treat as leadership-stated goal; MDAS cannot yet measure progress against it without SFDC reconciliation.

---

## Cross-Walk: MDAS CTAs ↔ Q3 Mitigation Plan

Accounts appearing in **both** the Jun 25 CTA scan (`expand3_cta_log.jsonl`) and the **Q3 Renewal Risk Mitigation Plan** (Jun 16):

| Account | CTA play (Jun 25) | Open? | Mitigation plan action due | Alignment |
| ------- | ----------------- | ----- | -------------------------- | --------- |
| Antylia Scientific | `dark_account` | Yes | Re-engage by 2026-06-26 | **Due this week** — CTA generated, not `team_aware` |
| Inmar, Inc. | `utilization_risk` | Yes | Rightsize proposal by 2026-06-30 | Aligned — utilization + engagement risk |
| Arista Networks | `managed_wind_down` | Yes | Exec outreach by 2026-06-12 | **Overdue** — plan predates scan; CTA still open |
| NorthStar Travel Media | `dark_account` | Yes | Lock renewal strategy by 2026-06-27 | **Due this week** |
| BI Incorporated | `dark_account` | Yes | Re-establish cadence | Aligned — dark engagement signals |
| Leafly, LLC | `dark_renewal` | Done | Revenue automation positioning | CTA marked `done` 2026-06-24 |
| Devex | `dark_renewal` | Done | TAM/product review support | CTA marked `done` 2026-06-24 |

**Gap:** Mitigation plan includes near-term saves (Omnitracs, iRobot, Perch, Pipedrive) not all surfaced in Jun 25 CTA scan — CTA gate (`requireRiskOrUnhealthy`) may suppress healthy-sentiment accounts even when mitigation plan flags exec escalation.

---

## Expand 3 Retention Context (from Glean, not MDAS)

From **FY27 CSE ATR** quota sheet (Apr 2026, verify before board use):

- Expand 3 **Q3 FY27 ATR target:** ~$4.57M (also cited in Nick's Q3 forecast analysis docs, Jun 6)
- Expand 3 **Q3 churn target:** $596K
- Expand 3 **Q3 net renewal target:** ~$3.97M

From **Q3 forecast analysis** (Nick Wilbur, Jun 6):

- Total churn/downsell exposure ~$1.35M — **materially above** $596K Q3 churn plan
- Credible churn-save opportunity ~$385K where defined save motion exists

**Leadership implication:** MDAS CTA scan flags ~$3.7M open ATR across 26 plays — broader than the $385K "credible save" subset. Managers need triage discipline, not blanket escalation.

---

## CSE Operational Norms (relevant to MDAS adoption)

From **CSE Operational Cadence** (Jan 2026 — process still directionally valid):

- CSE Sentiment: 2×/month for Red/Yellow, 1×/month for Green
- SFDC opportunity updates: weekly before Thurs/Fri forecast calls
- Churn forecasting: weekly CQ & CQ+1 renewal review with pod leader
- Required fields: ATR, ACV, Hedge, Churn Reason, mitigation plan

**MDAS supports:** `/hygiene` (sentiment staleness), `/forecast` (Clari-aligned script), `/ctas` (manager-directed asks), `/renewals` (8Q prospective pipeline).

**MDAS gap:** No automated hedge/churn-reason completeness score tied to weekly forecast cadence.

---

## Recommended Glean-Informed Actions (no blockers)

1. **Run `npm run cta:triage`** before Monday standup — paste output into Glean chat for AI narrative (per Page 3 pilot).
2. **Reconcile top 5 cross-walk accounts** against CSE Sentiment sheet (updated Jun 25) — Antylia, Inmar, Arista, NorthStar, BI.
3. **Validate Q3 ATR/churn targets** against live Clari — FY27 CSE ATR sheet is 10+ weeks old.
4. **Enable account plan pilot** on Antylia + Inmar + NorthStar (`ENABLE_EXPAND3_ACCOUNT_PLAN=true`) — all three appear in mitigation plan with near-term deadlines.

---

*Generated from workspace artifacts + Glean MCP search. No customer metrics invented.*
