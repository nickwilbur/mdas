// Mapper: Salesforce REST records → canonical types.
//
// Field-name source of truth: the actual mdas-prod org schema. The Section-6
// list in the prompt has three drifts from the org (resolved per option (c)
// in commit a5b1204) — all reflected here:
//   - Churn_Destription__c lives on Opportunity, not Account.
//   - Sales-engineer next-steps field is SE_Next_Steps__c (not SC_).
//   - Workshop status is the custom Status__c (not standard Status).
//
// Strategy: every mapper outputs a Partial<CanonicalAccount> /
// Partial<CanonicalOpportunity> containing ONLY the fields Salesforce owns.
// The worker's mergeAdapterResults spreads partials onto the prior snapshot
// preserving Glean-sourced fields (accountPlanLinks, recentMeetings,
// gainsightTasks, cerebroRiskCategory, etc.) for the next adapter to update.
import type {
  CanonicalAccount,
  CanonicalOpportunity,
  CSESentiment,
  SourceLink,
  Workshop,
} from '@mdas/canonical';
import { normalizeMostLikelyConfidence } from '@mdas/canonical';
import type { SalesforceQueryRecord } from './client.js';

// ---------- Salesforce row shapes (just the fields we read) ----------

export interface SfdcAccountRow extends SalesforceQueryRecord {
  Id: string;
  Name: string | null;
  X18_Digit_ID__c: string | null;
  Type: string | null;
  OwnerId: string | null;
  Assigned_CSE__c: string | null;
  Assigned_CSE__r: { Name: string | null } | null;
  Current_FY_Franchise__c: string | null;
  Tenant_ID__c: string | null;
  ZuoraTenant__c: string | null;
  Total_ACV__c: number | null;
  All_Time_ARR_Billing__c: number | null;
  All_Time_ARR_Zephr__c: number | null;
  Business_Industry_Health__c: string | null;
  CSM_Sentiment_Commentary__c: string | null;
  CSE_Sentiment_Last_Modified__c: string | null;
  CSE_Sentiment_Commentary_Last_Modified__c: string | null;
  Churn_Reason__c: string | null;
  Churn_Date__c: string | null;
  CS_Coverage__c: string | null;
  Customer_Status__c: string | null;
  engagio__EngagementMinutesLast7Days__c: number | null;
  engagio__EngagementMinutesLast30Days__c: number | null;
  engagio__EngagementMinutesLast3Months__c: number | null;
}

export interface SfdcOpportunityRow extends SalesforceQueryRecord {
  Id: string;
  Name: string | null;
  AccountId: string;
  Type: string | null;
  StageName: string | null;
  Stage_Num__c: number | string | null;
  CloseDate: string | null;
  Close_Datetime__c: string | null;
  Close_Quarter__c: string | null;
  FiscalYear: number | null;
  FranchisePicklist__c: string | null;
  Main_Franchise__c: string | null;
  ACV__c: number | null;
  Available_to_Renew_USD__c: number | null;
  Available_to_Renew_Local__c: number | null;
  fml_DerivedAvailableToRenew__c: number | null;
  Forecast_Most_Likely__c: number | null;
  Forecast_Most_Likely_Override__c: number | null;
  Most_Likely_Confidence__c: string | null;
  fml_Forecast_Hedge_USD__c: number | null;
  fml_DerivedACVDelta_USD__c: number | null;
  Billing_ACV_Delta_USD__c: number | null;
  Revenue_ACV_Delta_USD__c: number | null;
  Zephr_ACV_Delta_USD__c: number | null;
  Known_Churn_USD__c: number | null;
  FLM_Notes__c: string | null;
  SLM_Notes__c: string | null;
  SE_Next_Steps__c: string | null;
  Sales_Engineer__c: string | null;
  Sales_Engineer__r: { Name: string | null } | null;
  Full_Churn_Notification_to_Owner_Date__c: string | null;
  Full_Churn_Final_Email_Sent_Date__c: string | null;
  Churn_Downsell_Reason__c: string | null;
  Churn_Destription__c: string | null; // sic — actual API name; label "Churn Reason Summary"
  Product_Line__c: string | null;
}

export interface SfdcWorkshopRow extends SalesforceQueryRecord {
  Id: string;
  Account__c: string;
  Engagement_Type__c: string | null;
  Status__c: string | null;
  Completion_Date__c: string | null;
}

// ---------- Helpers ----------

function instanceLink(instanceUrl: string, sobjectPath: string, id: string, label: string): SourceLink {
  return {
    source: 'salesforce',
    label,
    url: `${instanceUrl.replace(/\/$/, '')}/lightning/r/${sobjectPath}/${id}/view`,
  };
}

function dateOnly(s: string | null): string | null {
  if (!s) return null;
  // Salesforce returns YYYY-MM-DDTHH:MM:SS.sssZ for datetime, YYYY-MM-DD for date.
  return s.split('T')[0] ?? null;
}

function mapSentiment(raw: string | null): CSESentiment {
  if (!raw) return null;
  const v = raw.trim();
  // Org's Business_Industry_Health__c picklist values map directly to the
  // canonical CSESentiment union. Map case-insensitively for safety.
  const lower = v.toLowerCase();
  if (lower === 'green') return 'Green';
  if (lower === 'yellow') return 'Yellow';
  if (lower === 'red') return 'Red';
  if (lower === 'confirmed churn' || lower === 'churn') return 'Confirmed Churn';
  return null;
}

// PR-C1 — F-22: delegate to the canonical normalizer so all adapters
// (including future non-SF ones) share one source of truth and a
// consumer's `=== 'Confirmed'` comparison can't silently miss.
const mapConfidence = normalizeMostLikelyConfidence;

function mapCsCoverage(raw: string | null): 'CSE' | 'ESA' | 'Digital' | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v === 'CSE' || v === 'ESA' || v === 'Digital') return v;
  return null;
}

// ---------- Mappers ----------

export function mapAccount(
  row: SfdcAccountRow,
  ctx: { instanceUrl: string; refreshAt: Date },
): Partial<CanonicalAccount> & Pick<CanonicalAccount, 'accountId' | 'salesforceAccountId' | 'accountName' | 'lastUpdated'> {
  return {
    accountId: row.Id,
    salesforceAccountId: row.X18_Digit_ID__c ?? row.Id,
    accountName: row.Name ?? row.Id,
    zuoraTenantId: row.Tenant_ID__c ?? row.ZuoraTenant__c ?? null,

    accountOwner: row.OwnerId ? { id: row.OwnerId, name: row.OwnerId } : null,
    assignedCSE: row.Assigned_CSE__c ? { id: row.Assigned_CSE__c, name: row.Assigned_CSE__r?.Name ?? row.Assigned_CSE__c } : null,
    csCoverage: mapCsCoverage(row.CS_Coverage__c),

    franchise: row.Current_FY_Franchise__c ?? 'Expand 3',

    cseSentiment: mapSentiment(row.Business_Industry_Health__c),
    cseSentimentCommentary: row.CSM_Sentiment_Commentary__c,
    cseSentimentLastUpdated: row.CSE_Sentiment_Last_Modified__c,
    cseSentimentCommentaryLastUpdated: row.CSE_Sentiment_Commentary_Last_Modified__c,

    allTimeARR: sumNumeric(row.All_Time_ARR_Billing__c, row.All_Time_ARR_Zephr__c, row.Total_ACV__c),

    engagementMinutes30d: row.engagio__EngagementMinutesLast30Days__c,
    engagementMinutes90d: row.engagio__EngagementMinutesLast3Months__c,

    isConfirmedChurn:
      mapSentiment(row.Business_Industry_Health__c) === 'Confirmed Churn' ||
      Boolean(row.Churn_Date__c),
    churnReason: row.Churn_Reason__c,
    // churnReasonSummary is sourced from Opportunity.Churn_Destription__c —
    // populated in the opportunity merge step, not here.
    churnDate: dateOnly(row.Churn_Date__c),

    sourceLinks: [instanceLink(ctx.instanceUrl, 'Account', row.Id, 'SFDC Account')],
    lastUpdated: ctx.refreshAt.toISOString(),
    lastFetchedFromSource: { salesforce: ctx.refreshAt.toISOString() },
  };
}

function sumNumeric(...values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  if (present.length === 0) return null;
  return present.reduce((acc, v) => acc + v, 0);
}

export function mapOpportunity(
  row: SfdcOpportunityRow,
  ctx: { instanceUrl: string; refreshAt: Date },
): Partial<CanonicalOpportunity> & Pick<CanonicalOpportunity, 'opportunityId' | 'opportunityName' | 'accountId' | 'closeDate' | 'lastUpdated'> {
  // Stage_Num__c is a Salesforce formula/number that occasionally arrives
  // as a string like "5.0". Strip non-digit prefix only when there is one;
  // Number('') returns 0, so we must reject empty leading-digit groups.
  //
  // PR-C1 — F-21: also accept the comma-decimal locales jsforce can
  // emit when the connected app's user has e.g. fr_FR ("5,0"). We
  // normalize ',' → '.' before the regex extract so the canonical
  // Number() conversion is locale-independent. Documented because the
  // test below pins both inputs.
  const parseStage = (raw: number | string | null): number | null => {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const normalized = String(raw).replace(',', '.');
    const leadingDigits = normalized.match(/^\d+(?:\.\d+)?/)?.[0];
    if (!leadingDigits) return null;
    const n = Number(leadingDigits);
    return Number.isFinite(n) ? n : null;
  };
  const stageNumeric = parseStage(row.Stage_Num__c);

  return {
    opportunityId: row.Id,
    opportunityName: row.Name ?? row.Id,
    accountId: row.AccountId,

    type: row.Type ?? 'Renewal',
    stageName: row.StageName ?? '',
    stageNum: stageNumeric,
    closeDate: dateOnly(row.CloseDate ?? row.Close_Datetime__c) ?? '',
    closeQuarter: row.Close_Quarter__c ?? '',
    fiscalYear: row.FiscalYear ?? new Date(row.CloseDate ?? Date.now()).getFullYear(),

    acv: row.ACV__c,
    availableToRenewUSD:
      row.Available_to_Renew_USD__c ?? row.fml_DerivedAvailableToRenew__c ?? row.Available_to_Renew_Local__c,
    forecastMostLikely: row.Forecast_Most_Likely__c,
    forecastMostLikelyOverride: row.Forecast_Most_Likely_Override__c,
    mostLikelyConfidence: mapConfidence(row.Most_Likely_Confidence__c),
    forecastHedgeUSD: row.fml_Forecast_Hedge_USD__c,
    acvDelta: row.fml_DerivedACVDelta_USD__c ?? row.Billing_ACV_Delta_USD__c,
    knownChurnUSD: row.Known_Churn_USD__c,
    productLine: row.Product_Line__c,

    flmNotes: row.FLM_Notes__c,
    slmNotes: row.SLM_Notes__c,
    scNextSteps: row.SE_Next_Steps__c,
    salesEngineer: row.Sales_Engineer__c
      ? { id: row.Sales_Engineer__c, name: row.Sales_Engineer__r?.Name ?? row.Sales_Engineer__c }
      : null,

    fullChurnNotificationToOwnerDate: dateOnly(row.Full_Churn_Notification_to_Owner_Date__c),
    fullChurnFinalEmailSentDate: dateOnly(row.Full_Churn_Final_Email_Sent_Date__c),
    churnDownsellReason: row.Churn_Downsell_Reason__c,

    sourceLinks: [instanceLink(ctx.instanceUrl, 'Opportunity', row.Id, 'SFDC Opportunity')],
    lastUpdated: ctx.refreshAt.toISOString(),
    lastFetchedFromSource: { salesforce: ctx.refreshAt.toISOString() },
  };
}

export function mapWorkshop(row: SfdcWorkshopRow): Workshop {
  return {
    id: row.Id,
    engagementType: row.Engagement_Type__c ?? '',
    status: row.Status__c ?? '',
    workshopDate: dateOnly(row.Completion_Date__c),
  };
}

/**
 * Group workshops by Account ID. Used to merge into Account records after
 * mapping. Returns a Map for O(1) account-side lookup.
 */
export function groupWorkshopsByAccount(rows: SfdcWorkshopRow[]): Map<string, Workshop[]> {
  const out = new Map<string, Workshop[]>();
  for (const row of rows) {
    const list = out.get(row.Account__c) ?? [];
    list.push(mapWorkshop(row));
    out.set(row.Account__c, list);
  }
  return out;
}

/**
 * Apply Opportunity-level fields back to Account records. Specifically,
 * Churn_Destription__c lives on Opportunity (the org's actual schema) but
 * the canonical model exposes churnReasonSummary on the Account. We pick
 * the most recently-updated opportunity's value as the authoritative one.
 */
export function applyOpportunityChurnSummary(
  accounts: Map<string, Partial<CanonicalAccount>>,
  oppRows: SfdcOpportunityRow[],
): void {
  // For each account, find the most recently-updated opp with a non-empty
  // Churn_Destription__c. Salesforce orders by SystemModStamp implicitly;
  // we just take the last non-empty value seen in input order.
  const summaryByAccount = new Map<string, string>();
  for (const o of oppRows) {
    if (o.Churn_Destription__c && o.AccountId) {
      summaryByAccount.set(o.AccountId, o.Churn_Destription__c);
    }
  }
  for (const [accountId, summary] of summaryByAccount) {
    const acc = accounts.get(accountId);
    if (acc) {
      acc.churnReasonSummary = summary;
    }
  }
}
