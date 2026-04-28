# Salesforce Integration

MDAS reads structured Account / Opportunity / Workshop_Engagement__c data from the Zuora production Salesforce org. The integration has two surfaces: a **runtime** path (the worker calling SFDC at refresh time) and a **dev/CI tooling** path (the `sf` CLI used for schema validation, field-map generation, and ad-hoc debugging).

## Org

| Alias | Username | Org ID |
|---|---|---|
| `mdas-prod` | `nick.wilbur@zuora.com` | `00D700000009EWMEA2` |

There is **no sandbox**. Every CLI tool here runs against production but is restricted to **read-only metadata operations** (`sf sobject describe`) — it never touches record data.

## Local-dev auth

```bash
make sf-login
```

The target is idempotent. If `mdas-prod` is already authenticated, it prints the org info; otherwise it opens `sf org login web --alias mdas-prod`.

`.sfdx/` and `.sf/` are gitignored — auth tokens stay on the developer machine.

## Schema validation (CI)

`make sf-validate` (or `npm run sf:validate`) cross-checks every Salesforce field referenced in the MDAS Salesforce adapter (the SOQL constants in `packages/adapters/read/salesforce/src/index.ts`) against the generated field-map at `packages/adapters/read/salesforce/generated/field-map.ts`. It exits non-zero on any of:

- Referenced field missing from the org (rename or removal)
- Referenced field exists but has an unexpected type (e.g., currency → string)
- Generated field-map missing or malformed

When validation fails, the developer either:

1. Fixes the SOQL constant + the `EXPECTED_REFERENCES` list in `scripts/validate-salesforce-schema.ts` to match the new API name, **or**
2. Asks the Salesforce admin to restore the field if the rename was unintended.

The validator is wired into the `sf:validate` npm script and runs in CI on every PR. As of PR-3 the Salesforce adapter is in the runtime hot path; the validator is now a regression guard rather than a pre-launch gate.

## Field-map regeneration

```bash
make sf-fieldmap     # → npm run sf:fieldmap → tsx scripts/generate-sfdc-field-map.ts
```

Calls `sf sobject describe --json` for `Account`, `Opportunity`, and `Workshop_Engagement__c`, and emits a TypeScript module at `packages/adapters/read/salesforce/generated/field-map.ts` containing every field's API name, label, type, custom flag, nillable flag, length, and reference target list.

The generated file **is checked in** so PR review surfaces field renames and additions as diffs. It is `AUTO-GENERATED` — never edit by hand. Re-run after any Salesforce admin change.

`SF_TARGET_ORG` env var overrides the default `mdas-prod` alias if needed for ad-hoc work.

## Runtime auth (production)

The runtime worker container does **not** ship `sf`. Salesforce calls are issued via OAuth refresh-token grant against `/services/oauth2/token`, with credentials stored in Docker secrets:

| Env var | Purpose |
|---|---|
| `SALESFORCE_CLIENT_ID` | Connected App client ID |
| `SALESFORCE_CLIENT_SECRET` | Connected App secret |
| `SALESFORCE_REFRESH_TOKEN` | Refresh token (rotates as needed) |
| `SALESFORCE_INSTANCE_URL` | e.g., `https://zuora.my.salesforce.com` |

These are read by `readSalesforceCredsFromEnv()` in `packages/adapters/read/salesforce/src/client.ts`. As of PR-3 the adapter is fully wired: `salesforceAdapter.fetch()` issues 3 parallel SOQL queries, escalates `Workshop_Engagement__c` to Bulk 2.0 above 1500 rows, and emits populated `Partial<CanonicalAccount>` / `Partial<CanonicalOpportunity>` records via the mapper at `mapper.ts`. See `docs/field-map.md` for the Section-6-vs-org alias table covering the 3 fields where the prompt and the prod org disagreed.

## Bulk API 2.0 (live as of PR-3)

The `Workshop_Engagement__c` query (`LAST_N_DAYS:365` across the entire object) routinely exceeds the REST 2,000-row default. The runtime adapter uses `@jsforce/jsforce-node`'s Bulk 2.0 client (`conn.bulk2.query(...)`) — falling back to REST results if Bulk fails. Heuristic threshold: REST is tried first; if it returns ≥1500 rows the next refresh upgrades that query to Bulk 2.0 (`BULK_THRESHOLD` constant in `index.ts`). The `sf data query --bulk` command is **not** used at runtime — only as a developer escape hatch for ad-hoc debugging.

## Ad-hoc debugging recipes

Run a one-off SOQL against prod (read-only):

```bash
sf data query --query "SELECT COUNT() FROM Account WHERE Current_FY_Franchise__c = 'Expand 3'" --target-org mdas-prod
```

Compare what the adapter sees vs. what production has:

```bash
sf data query --query "SELECT Id, Name, Current_FY_Franchise__c FROM Account LIMIT 5" --target-org mdas-prod --result-format csv
```

Re-introspect a single field's metadata after a rename:

```bash
sf sobject describe --sobject Opportunity --target-org mdas-prod --json | jq '.result.fields[] | select(.name == "SE_Next_Steps__c")'
```

## CI-guard interaction

`scripts/ci-guard.mjs` check #4 fails on any line in `packages/adapters/**/*.{ts,js}` that matches a write-verb pattern (jsforce mutating methods, `sf data` write subcommands, mutating REST verbs to `/sobjects` or `/composite`, write-shaped Glean tools). Single-line escape: append `// ci-guard:allow`. The MDAS Salesforce adapter MUST stay read-only.
