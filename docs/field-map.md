# Salesforce Field Map — Section 6 (design doc) vs `mdas-prod` org

This table is the alias map between the field names in **Section 6 of the original MDAS design doc** (the prompt under which this codebase was built) and the **actual API names in the `mdas-prod` Salesforce org**.

It exists because three fields drifted between the two during PR-2's schema validation (see `docs/refactor-analysis.md`). PR-3 chose **option (c)**: accept the org as ground truth, edit the SOQL constants and the validator's `EXPECTED_REFERENCES` to match, and document the drifts here.

## Authoritative sources

- **Org schema (truth)**: `packages/adapters/read/salesforce/generated/field-map.ts` — regenerated from `sf sobject describe` via `npm run sf:fieldmap`. Checked in; PR diffs surface field renames before they reach prod.
- **Validator**: `scripts/validate-salesforce-schema.ts` runs on every PR via CI and fails the build if the SOQL constants reference fields the org doesn't have.

If a future field rename happens, the validator fails first, then this doc is updated as part of the same PR.

## Drift table

| Section 6 name | Actual `mdas-prod` API name | Why it drifted | Resolved in |
|---|---|---|---|
| `Account.Churn_Destription__c` | `Opportunity.Churn_Destription__c` | The "churn description" field was modeled on `Account` in the design doc but in the org it lives on `Opportunity` (it's per-renewal-cycle, not per-account). The mapper projects it back onto `Account.churnReasonSummary` via `applyOpportunityChurnSummary()` so canonical exposes it where the design doc expected. | PR-3 (`mapper.ts`) |
| `Opportunity.SC_Next_Steps__c` | `Opportunity.SE_Next_Steps__c` | Renamed when SC (Solution Consulting) was rebranded to SE (Sales Engineering) inside Zuora. Same field, same semantics, different prefix. | PR-3 (SOQL constant + canonical type comment) |
| `Workshop_Engagement__c.Status` | `Workshop_Engagement__c.Status__c` | Section 6 listed the standard-field name; the org uses a custom-field replacement (`__c` suffix) — common in Salesforce when teams want pick-list values they control independently of the standard field's history. | PR-3 (SOQL constant + mapper field type) |

## Verification

After any field-map regeneration, the validator confirms all 61 SOQL-referenced fields are still present with their expected types:

```sh
npm run sf:fieldmap     # regenerate generated/field-map.ts from sf CLI
npm run sf:validate     # → "OK — 61 referenced fields all present"
```

CI runs `npm run sf:validate` on every PR. If a field disappears or its type changes (e.g., `Decimal` → `Boolean`), CI fails before the bad SOQL ever runs against prod.

## Process for future drift

1. Schema admin renames or moves a field in Salesforce.
2. Next PR (or scheduled `sf:fieldmap` run) regenerates `generated/field-map.ts` — diff is visible.
3. `sf:validate` fails because the SOQL constants now reference a missing field.
4. PR author either:
   - Updates the SOQL + canonical mapping + this doc, or
   - Asks the SF admin to revert / alias the rename if MDAS-side changes are too risky.
5. Validator goes green; merge.

This is the closed-loop the PR-2 analysis recommended — the alias table is intentionally short because most schema changes should reach the SOQL constants, not just this doc.
