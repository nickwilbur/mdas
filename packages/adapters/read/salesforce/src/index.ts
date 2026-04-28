// Salesforce read-only adapter for MDAS.
// Source of truth for Account / Opportunity / Workshop_Engagement__c records
// in the Expand 3 franchise. Gainsight is the system of record for CSE Sentiment
// but mirrors the value to Salesforce — we read it from Salesforce here and
// cross-check via the Gainsight adapter.
//
// Read-only: only SOQL queries via /services/data/vXX.X/query and /search.
// All HTTP routed through readOnlyGuard.

import type {
  CanonicalAccount,
  ReadAdapter,
  AdapterFetchResult,
  RefreshContext,
} from '@mdas/canonical';
import { SalesforceClient, readSalesforceCredsFromEnv } from './client.js';
import {
  applyOpportunityChurnSummary,
  groupWorkshopsByAccount,
  mapAccount,
  mapOpportunity,
  type SfdcAccountRow,
  type SfdcOpportunityRow,
  type SfdcWorkshopRow,
} from './mapper.js';

export const isReadOnly: true = true;

// Field-name source of truth: the actual `mdas-prod` org schema
// (see packages/adapters/read/salesforce/generated/field-map.ts).
// Where the prompt's Section 6 list disagrees with the org, the org wins.
// Drifts resolved per option (c) on 2026-04-28; alias table will be
// captured in docs/field-map.md (PR-6).
//   Account.Churn_Destription__c    → moved to Opportunity (org schema)
//   Opportunity.SC_Next_Steps__c    → renamed Opportunity.SE_Next_Steps__c
//   Workshop_Engagement__c.Status   → renamed Workshop_Engagement__c.Status__c
export const SOQL_ACCOUNTS = `
SELECT
  Id, Name, X18_Digit_ID__c, Type, OwnerId, Assigned_CSE__c,
  Current_FY_Franchise__c, Tenant_ID__c, ZuoraTenant__c,
  Total_ACV__c, All_Time_ARR_Billing__c, All_Time_ARR_Zephr__c,
  Business_Industry_Health__c, CSM_Sentiment_Commentary__c,
  CSE_Sentiment_Last_Modified__c, CSE_Sentiment_Commentary_Last_Modified__c,
  Churn_Reason__c, Churn_Date__c,
  CS_Coverage__c,
  engagio__EngagementMinutesLast7Days__c,
  engagio__EngagementMinutesLast30Days__c,
  engagio__EngagementMinutesLast3Months__c
FROM Account
WHERE Current_FY_Franchise__c = 'Expand 3'
`;

export const SOQL_OPPS = `
SELECT
  Id, Name, AccountId, Type, StageName, Stage_Num__c,
  CloseDate, Close_Datetime__c, Close_Quarter__c, FiscalYear,
  FranchisePicklist__c, Main_Franchise__c,
  ACV__c,
  Available_to_Renew_USD__c, Available_to_Renew_Local__c, fml_DerivedAvailableToRenew__c,
  Forecast_Most_Likely__c, Forecast_Most_Likely_Override__c, Most_Likely_Confidence__c,
  fml_Forecast_Hedge_USD__c,
  fml_DerivedACVDelta_USD__c, Billing_ACV_Delta_USD__c, Revenue_ACV_Delta_USD__c, Zephr_ACV_Delta_USD__c,
  Known_Churn_USD__c,
  FLM_Notes__c, SLM_Notes__c, SE_Next_Steps__c,
  Sales_Engineer__c,
  Full_Churn_Notification_to_Owner_Date__c, Full_Churn_Final_Email_Sent_Date__c,
  Churn_Downsell_Reason__c, Churn_Destription__c,
  Product_Line__c
FROM Opportunity
WHERE FranchisePicklist__c = 'Expand 3'
  AND Main_Franchise__c = 'North America'
  AND CloseDate >= THIS_FISCAL_QUARTER
  AND CloseDate <= NEXT_N_FISCAL_QUARTERS:4
`;

export const SOQL_WORKSHOPS = `
SELECT Id, Account__c, Engagement_Type__c, Status__c, Completion_Date__c
FROM Workshop_Engagement__c
WHERE Completion_Date__c = LAST_N_DAYS:365
`;

/**
 * Heuristic threshold above which the Workshop history query is escalated
 * from REST to Bulk API 2.0. The Workshop_Engagement__c LAST_N_DAYS:365
 * pull commonly returns several thousand rows; REST's 2,000-row default
 * page would force pagination and slower wall-clock. Bulk 2.0 streams the
 * full result set in a single CSV.
 *
 * Tuning: drop to 500 to force Bulk for any reasonably-sized historical
 * pull during dev; raise to e.g. 2000 if Bulk's job-prep latency outweighs
 * its bandwidth advantage in your tenant.
 */
const BULK_THRESHOLD = 1500;

export const salesforceAdapter: ReadAdapter = {
  name: 'salesforce',
  source: 'salesforce',
  isReadOnly: true,
  async fetch(
    _input: { franchise: string },
    ctx?: RefreshContext,
  ): Promise<Partial<AdapterFetchResult>> {
    const creds = readSalesforceCredsFromEnv();
    if (!creds) {
      // Adapter is opt-in via env. Missing creds → return empty so the
      // worker proceeds with localSnapshots + other adapters.
      return { accounts: [], opportunities: [] };
    }

    const refreshAt = ctx?.asOf ?? new Date();
    const log = ctx?.logger;
    const client = new SalesforceClient(creds);

    // 1) Pull the three structured object queries. Accounts and Opps go
    //    through REST (small enough). Workshops use REST with auto-paging
    //    unless the count exceeds BULK_THRESHOLD — escalate transparently.
    const [accountRows, oppRows, workshopRowsInitial] = await Promise.all([
      client.query<SfdcAccountRow>(SOQL_ACCOUNTS),
      client.query<SfdcOpportunityRow>(SOQL_OPPS),
      client.query<SfdcWorkshopRow>(SOQL_WORKSHOPS),
    ]);

    let workshopRows: SfdcWorkshopRow[] = workshopRowsInitial;
    // If REST's auto-pagination returned a large set, log it; if it would
    // have been throttled by row caps we'd already have noticed at fetch
    // time. Bulk 2.0 escalation is reserved for the (rare) case where
    // initial counts indicate >BULK_THRESHOLD with active throttling.
    if (workshopRows.length >= BULK_THRESHOLD) {
      try {
        log?.info('salesforce.bulkQuery.escalate', {
          rows: workshopRows.length,
          threshold: BULK_THRESHOLD,
          sobject: 'Workshop_Engagement__c',
        });
        workshopRows = await client.bulkQuery<SfdcWorkshopRow>(SOQL_WORKSHOPS);
      } catch (err) {
        // Bulk failure is non-fatal — fall back to the REST results we
        // already have. Logged for triage.
        log?.warn('salesforce.bulkQuery.failed', {
          error: (err as Error).message,
          fallbackRows: workshopRows.length,
        });
      }
    }

    log?.info('salesforce.fetched', {
      accounts: accountRows.length,
      opportunities: oppRows.length,
      workshops: workshopRows.length,
    });

    // 2) Map → canonical (partials).
    const mapCtx = { instanceUrl: creds.instanceUrl, refreshAt };
    const accountsByIdPartial = new Map<string, Partial<CanonicalAccount>>();
    for (const row of accountRows) {
      accountsByIdPartial.set(row.Id, mapAccount(row, mapCtx));
    }

    // 3) Apply opp-level Churn_Destription__c → account.churnReasonSummary
    //    (the org keeps the field on Opportunity; canonical exposes it on
    //    Account, so we project before producing the merged record set).
    applyOpportunityChurnSummary(accountsByIdPartial, oppRows);

    // 4) Group workshops onto accounts.
    const workshopsByAccount = groupWorkshopsByAccount(workshopRows);
    for (const [accountId, workshops] of workshopsByAccount) {
      const acc = accountsByIdPartial.get(accountId);
      if (acc) acc.workshops = workshops;
    }

    const opportunities = oppRows.map((row) => mapOpportunity(row, mapCtx));

    // Cast to AdapterFetchResult is safe because the worker's
    // mergeAdapterResults spreads partials onto the prior snapshot
    // (see PR-1 architecture). Fields the partials don't set are
    // preserved from localSnapshots / other adapters.
    return {
      accounts: Array.from(accountsByIdPartial.values()) as CanonicalAccount[],
      opportunities: opportunities as AdapterFetchResult['opportunities'],
    };
  },
  async healthCheck(_ctx?: RefreshContext): Promise<{ ok: boolean; details: string }> {
    const creds = readSalesforceCredsFromEnv();
    if (!creds) return { ok: false, details: 'SALESFORCE_* env vars not set' };
    const client = new SalesforceClient(creds);
    return client.healthCheck();
  },
};

export default salesforceAdapter;
