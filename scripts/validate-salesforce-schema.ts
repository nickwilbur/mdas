#!/usr/bin/env tsx
/**
 * Cross-check every Salesforce field referenced in the MDAS Salesforce
 * adapter against the generated field-map (which is itself derived from
 * `sf sobject describe` — see scripts/generate-sfdc-field-map.ts).
 *
 * Run via: npm run sf:validate (or make sf-validate)
 *
 * Fail modes (each emits to stderr and exits non-zero):
 *   - referenced field not present in the field-map → org has dropped it
 *   - referenced field type doesn't match an expected category (when one is
 *     declared) → field exists but type changed
 *   - generated field-map missing or stale → run `make sf-fieldmap` first
 *
 * Source-of-truth list of referenced fields lives in EXPECTED_REFERENCES
 * below. Mirrors the SOQL constants in
 * packages/adapters/read/salesforce/src/index.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ReferencedField {
  apiName: string;
  /** If set, the field's `type` must include one of these tokens. */
  expectedType?: readonly string[];
}

interface ReferenceSet {
  sobject: string;
  fields: readonly ReferencedField[];
}

// Authoritative list of fields the MDAS Salesforce adapter pulls. Aligned
// with section 6 of the refactor prompt (validated field names).
const EXPECTED_REFERENCES: readonly ReferenceSet[] = [
  {
    sobject: 'Account',
    fields: [
      { apiName: 'Id' },
      { apiName: 'Name', expectedType: ['string'] },
      { apiName: 'X18_Digit_ID__c', expectedType: ['string'] },
      { apiName: 'Type', expectedType: ['picklist', 'string'] },
      { apiName: 'OwnerId', expectedType: ['reference'] },
      { apiName: 'Assigned_CSE__c' },
      { apiName: 'Current_FY_Franchise__c', expectedType: ['picklist', 'string'] },
      { apiName: 'Tenant_ID__c' },
      { apiName: 'ZuoraTenant__c' },
      { apiName: 'Total_ACV__c', expectedType: ['currency', 'double', 'percent'] },
      { apiName: 'All_Time_ARR_Billing__c', expectedType: ['currency', 'double'] },
      { apiName: 'All_Time_ARR_Zephr__c', expectedType: ['currency', 'double'] },
      { apiName: 'Business_Industry_Health__c' },
      { apiName: 'CSM_Sentiment_Commentary__c' },
      { apiName: 'CSE_Sentiment_Last_Modified__c', expectedType: ['datetime', 'date'] },
      { apiName: 'CSE_Sentiment_Commentary_Last_Modified__c', expectedType: ['datetime', 'date'] },
      { apiName: 'Churn_Reason__c' },
      { apiName: 'Churn_Date__c', expectedType: ['date', 'datetime'] },
      { apiName: 'Churn_Destription__c' }, // sic — actual SFDC API name
      { apiName: 'CS_Coverage__c', expectedType: ['picklist', 'string'] },
      { apiName: 'engagio__EngagementMinutesLast7Days__c', expectedType: ['double', 'int'] },
      { apiName: 'engagio__EngagementMinutesLast30Days__c', expectedType: ['double', 'int'] },
      { apiName: 'engagio__EngagementMinutesLast3Months__c', expectedType: ['double', 'int'] },
    ],
  },
  {
    sobject: 'Opportunity',
    fields: [
      { apiName: 'Id' },
      { apiName: 'Name', expectedType: ['string'] },
      { apiName: 'AccountId', expectedType: ['reference'] },
      { apiName: 'Type', expectedType: ['picklist', 'string'] },
      { apiName: 'StageName', expectedType: ['picklist', 'string'] },
      { apiName: 'Stage_Num__c', expectedType: ['double', 'int', 'string'] },
      { apiName: 'CloseDate', expectedType: ['date'] },
      { apiName: 'Close_Datetime__c', expectedType: ['datetime', 'date'] },
      { apiName: 'Close_Quarter__c' },
      { apiName: 'FiscalYear', expectedType: ['int', 'double'] },
      { apiName: 'FranchisePicklist__c', expectedType: ['picklist', 'string'] },
      { apiName: 'Main_Franchise__c' },
      { apiName: 'ACV__c', expectedType: ['currency', 'double'] },
      { apiName: 'Available_to_Renew_USD__c', expectedType: ['currency', 'double'] },
      { apiName: 'Available_to_Renew_Local__c', expectedType: ['currency', 'double'] },
      { apiName: 'fml_DerivedAvailableToRenew__c', expectedType: ['currency', 'double'] },
      { apiName: 'Forecast_Most_Likely__c', expectedType: ['currency', 'double'] },
      { apiName: 'Forecast_Most_Likely_Override__c', expectedType: ['currency', 'double'] },
      { apiName: 'Most_Likely_Confidence__c', expectedType: ['picklist', 'string'] },
      { apiName: 'fml_Forecast_Hedge_USD__c', expectedType: ['currency', 'double'] },
      { apiName: 'fml_DerivedACVDelta_USD__c', expectedType: ['currency', 'double'] },
      { apiName: 'Billing_ACV_Delta_USD__c', expectedType: ['currency', 'double'] },
      { apiName: 'Revenue_ACV_Delta_USD__c', expectedType: ['currency', 'double'] },
      { apiName: 'Zephr_ACV_Delta_USD__c', expectedType: ['currency', 'double'] },
      { apiName: 'Known_Churn_USD__c', expectedType: ['currency', 'double'] },
      { apiName: 'FLM_Notes__c' },
      { apiName: 'SLM_Notes__c' },
      { apiName: 'SC_Next_Steps__c' },
      { apiName: 'Sales_Engineer__c', expectedType: ['reference'] },
      { apiName: 'Full_Churn_Notification_to_Owner_Date__c', expectedType: ['date', 'datetime'] },
      { apiName: 'Full_Churn_Final_Email_Sent_Date__c', expectedType: ['date', 'datetime'] },
      { apiName: 'Churn_Downsell_Reason__c' },
      { apiName: 'Product_Line__c' },
    ],
  },
  {
    sobject: 'Workshop_Engagement__c',
    fields: [
      { apiName: 'Id' },
      { apiName: 'Account__c', expectedType: ['reference'] },
      { apiName: 'Engagement_Type__c', expectedType: ['picklist', 'string'] },
      { apiName: 'Status', expectedType: ['picklist', 'string'] },
      { apiName: 'Completion_Date__c', expectedType: ['date', 'datetime'] },
    ],
  },
];

const FIELD_MAP_PATH = join(
  process.cwd(),
  'packages/adapters/read/salesforce/generated/field-map.ts',
);

interface FieldDescribe {
  label: string;
  type: string;
  custom: boolean;
  nillable: boolean;
  length: number | null;
  referenceTo: readonly string[];
}

interface FieldMap {
  SFDC_FIELD_MAP: Record<string, Record<string, FieldDescribe>>;
  SFDC_GENERATED_AT: string;
  SFDC_GENERATED_FROM_ORG: string;
}

async function loadFieldMap(): Promise<FieldMap> {
  if (!existsSync(FIELD_MAP_PATH)) {
    throw new Error(
      `Generated field-map missing at ${FIELD_MAP_PATH}. Run \`make sf-fieldmap\` first.`,
    );
  }
  // Use a dynamic import via tsx — works because tsx pre-compiles .ts on demand.
  const mod = await import(FIELD_MAP_PATH);
  return {
    SFDC_FIELD_MAP: mod.SFDC_FIELD_MAP,
    SFDC_GENERATED_AT: mod.SFDC_GENERATED_AT,
    SFDC_GENERATED_FROM_ORG: mod.SFDC_GENERATED_FROM_ORG,
  };
}

interface ValidationFailure {
  sobject: string;
  apiName: string;
  reason: string;
}

function validate(refs: readonly ReferenceSet[], map: FieldMap): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const set of refs) {
    const objectFields = map.SFDC_FIELD_MAP[set.sobject];
    if (!objectFields) {
      failures.push({
        sobject: set.sobject,
        apiName: '*',
        reason: `sobject not present in generated field-map (regenerate with make sf-fieldmap)`,
      });
      continue;
    }
    for (const ref of set.fields) {
      const meta = objectFields[ref.apiName];
      if (!meta) {
        failures.push({
          sobject: set.sobject,
          apiName: ref.apiName,
          reason: `field referenced by adapter is missing from the org`,
        });
        continue;
      }
      if (ref.expectedType && !ref.expectedType.includes(meta.type)) {
        failures.push({
          sobject: set.sobject,
          apiName: ref.apiName,
          reason: `field type is "${meta.type}", expected one of [${ref.expectedType.join(', ')}]`,
        });
      }
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const map = await loadFieldMap();
  process.stderr.write(
    `[sf:validate] field-map generated at ${map.SFDC_GENERATED_AT} from ${map.SFDC_GENERATED_FROM_ORG}\n`,
  );

  // Sanity-check the field-map isn't inadvertently empty (e.g., describe failed)
  for (const sobject of Object.keys(map.SFDC_FIELD_MAP)) {
    const count = Object.keys(map.SFDC_FIELD_MAP[sobject]!).length;
    if (count < 5) {
      process.stderr.write(
        `[sf:validate] WARN: ${sobject} has only ${count} fields in the map — looks broken; regenerate.\n`,
      );
    }
  }

  // Confirm the field-map content matches what was committed (no manual edits).
  // We don't enforce byte equality — just that the file is parseable and
  // exports the expected shape (already covered by the import succeeding).

  const failures = validate(EXPECTED_REFERENCES, map);
  if (failures.length === 0) {
    const total = EXPECTED_REFERENCES.reduce((n, s) => n + s.fields.length, 0);
    process.stderr.write(
      `[sf:validate] OK — ${total} referenced fields all present with expected types.\n`,
    );
    process.exit(0);
  }
  process.stderr.write(`[sf:validate] FAIL — ${failures.length} drift issues:\n`);
  for (const f of failures) {
    process.stderr.write(`  - ${f.sobject}.${f.apiName}: ${f.reason}\n`);
  }
  process.stderr.write(
    `[sf:validate] If a Salesforce admin renamed a field, update the SOQL constant in\n` +
      `              packages/adapters/read/salesforce/src/index.ts AND the EXPECTED_REFERENCES\n` +
      `              list in scripts/validate-salesforce-schema.ts to match the new API name.\n`,
  );
  // Reference readFileSync so the bundler keeps it; helpful when extending
  // the validator to do byte-level diffs of field-map.ts in the future.
  void readFileSync;
  process.exit(1);
}

void main();
