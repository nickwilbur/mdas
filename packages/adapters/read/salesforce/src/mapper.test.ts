import { describe, expect, it } from 'vitest';
import {
  applyOpportunityChurnSummary,
  groupWorkshopsByAccount,
  mapAccount,
  mapOpportunity,
  mapWorkshop,
  type SfdcAccountRow,
  type SfdcOpportunityRow,
  type SfdcWorkshopRow,
} from './mapper.js';
import type { CanonicalAccount } from '@mdas/canonical';

const REFRESH_AT = new Date('2026-04-28T18:00:00.000Z');
const CTX = { instanceUrl: 'https://zuora.my.salesforce.com', refreshAt: REFRESH_AT };

const SAMPLE_ACCOUNT_ROW: SfdcAccountRow = {
  Id: '0017000000abc123',
  Name: 'Stenograph LLC',
  X18_Digit_ID__c: '0014u00001zmSSOAA2',
  Type: 'Customer',
  OwnerId: '0050g000005xyzAAA',
  Assigned_CSE__c: '0050g000005z5SbAAI',
  // Added 2026-04-28 (PR-A1): mapper.ts requires the related-record
  // resolver alongside the FK Id so assignedCSE.name renders the human
  // name in the UI rather than the opaque 18-char user Id. Default to
  // null in the base fixture so existing tests (which don't assert on
  // the resolver) still cover the fallback-to-Id path; resolver-happy-
  // path coverage is added below.
  Assigned_CSE__r: null,
  Current_FY_Franchise__c: 'Expand 3',
  // Added 2026-04-28 (PR-A1): SOQL_ACCOUNTS already filters by
  // Customer_Status__c IN ('Live', 'Implementing', 'In Production',
  // 'Churned (Live)'). Mapper currently doesn't read it — kept on the
  // row interface for future use and to keep fixture parity with the
  // SOQL projection.
  Customer_Status__c: 'Live',
  Tenant_ID__c: 'tenant-stenograph',
  ZuoraTenant__c: null,
  Total_ACV__c: 100000,
  All_Time_ARR_Billing__c: 50000,
  All_Time_ARR_Zephr__c: 25000,
  Business_Industry_Health__c: 'Yellow',
  CSM_Sentiment_Commentary__c: 'Watching closely',
  CSE_Sentiment_Last_Modified__c: '2026-04-20T15:30:00.000+0000',
  CSE_Sentiment_Commentary_Last_Modified__c: '2026-04-21T15:30:00.000+0000',
  Churn_Reason__c: null,
  Churn_Date__c: null,
  CS_Coverage__c: 'CSE',
  engagio__EngagementMinutesLast7Days__c: 12,
  engagio__EngagementMinutesLast30Days__c: 60,
  engagio__EngagementMinutesLast3Months__c: 180,
};

describe('mapAccount', () => {
  it('maps every SF-owned canonical field from a populated row', () => {
    const out = mapAccount(SAMPLE_ACCOUNT_ROW, CTX);
    expect(out.accountId).toBe('0017000000abc123');
    expect(out.salesforceAccountId).toBe('0014u00001zmSSOAA2');
    expect(out.accountName).toBe('Stenograph LLC');
    expect(out.zuoraTenantId).toBe('tenant-stenograph');
    expect(out.assignedCSE).toEqual({ id: '0050g000005z5SbAAI', name: '0050g000005z5SbAAI' });
    expect(out.csCoverage).toBe('CSE');
    expect(out.cseSentiment).toBe('Yellow');
    expect(out.allTimeARR).toBe(175000); // sum of billing + zephr + total ACV
    expect(out.engagementMinutes30d).toBe(60);
    expect(out.engagementMinutes90d).toBe(180);
    expect(out.isConfirmedChurn).toBe(false);
    expect(out.lastUpdated).toBe(REFRESH_AT.toISOString());
    expect(out.lastFetchedFromSource).toEqual({ salesforce: REFRESH_AT.toISOString() });
    expect(out.sourceLinks).toEqual([
      {
        source: 'salesforce',
        label: 'SFDC Account',
        url: 'https://zuora.my.salesforce.com/lightning/r/Account/0017000000abc123/view',
      },
    ]);
  });

  it('falls back to Id when X18_Digit_ID__c is null', () => {
    const out = mapAccount({ ...SAMPLE_ACCOUNT_ROW, X18_Digit_ID__c: null }, CTX);
    expect(out.salesforceAccountId).toBe('0017000000abc123');
  });

  it('marks Confirmed Churn from sentiment OR a Churn_Date__c', () => {
    const fromSentiment = mapAccount(
      { ...SAMPLE_ACCOUNT_ROW, Business_Industry_Health__c: 'Confirmed Churn' },
      CTX,
    );
    expect(fromSentiment.isConfirmedChurn).toBe(true);
    expect(fromSentiment.cseSentiment).toBe('Confirmed Churn');

    const fromDate = mapAccount(
      { ...SAMPLE_ACCOUNT_ROW, Business_Industry_Health__c: 'Yellow', Churn_Date__c: '2026-06-01' },
      CTX,
    );
    expect(fromDate.isConfirmedChurn).toBe(true);
  });

  it('returns null sentiment for unknown picklist values', () => {
    const out = mapAccount({ ...SAMPLE_ACCOUNT_ROW, Business_Industry_Health__c: 'Mauve' }, CTX);
    expect(out.cseSentiment).toBeNull();
  });

  it('returns null csCoverage for non-canonical values', () => {
    const out = mapAccount({ ...SAMPLE_ACCOUNT_ROW, CS_Coverage__c: 'Self-Serve' }, CTX);
    expect(out.csCoverage).toBeNull();
  });

  it('returns null allTimeARR when every input is null', () => {
    const out = mapAccount(
      {
        ...SAMPLE_ACCOUNT_ROW,
        Total_ACV__c: null,
        All_Time_ARR_Billing__c: null,
        All_Time_ARR_Zephr__c: null,
      },
      CTX,
    );
    expect(out.allTimeARR).toBeNull();
  });

  it('resolves assignedCSE.name from Assigned_CSE__r.Name when present', () => {
    // Production-relevant: real SOQL pulls Assigned_CSE__r.Name so the
    // UI shows "Jane Doe" instead of "0050g000005z5SbAAI". The default
    // fixture leaves __r null to exercise the fallback; this case
    // covers the happy path explicitly.
    const out = mapAccount(
      { ...SAMPLE_ACCOUNT_ROW, Assigned_CSE__r: { Name: 'Jane Doe' } },
      CTX,
    );
    expect(out.assignedCSE).toEqual({
      id: '0050g000005z5SbAAI',
      name: 'Jane Doe',
    });
  });
});

const SAMPLE_OPP_ROW: SfdcOpportunityRow = {
  Id: '006Po00001F2TRNIA3',
  Name: 'Stenograph - Billing Volume',
  AccountId: '0017000000abc123',
  Type: 'Amendment',
  StageName: '5.0 Propose',
  Stage_Num__c: 5,
  CloseDate: '2026-04-28',
  Close_Datetime__c: '2026-04-28T00:00:00.000+0000',
  Close_Quarter__c: 'Q1',
  FiscalYear: 2027,
  FranchisePicklist__c: 'Expand 3',
  Main_Franchise__c: 'North America',
  ACV__c: 10500,
  Available_to_Renew_USD__c: null,
  Available_to_Renew_Local__c: null,
  fml_DerivedAvailableToRenew__c: 10500,
  Forecast_Most_Likely__c: 10500,
  Forecast_Most_Likely_Override__c: null,
  Most_Likely_Confidence__c: 'Medium',
  fml_Forecast_Hedge_USD__c: 0,
  fml_DerivedACVDelta_USD__c: 0,
  Billing_ACV_Delta_USD__c: 0,
  Revenue_ACV_Delta_USD__c: null,
  Zephr_ACV_Delta_USD__c: null,
  Known_Churn_USD__c: 0,
  FLM_Notes__c: null,
  SLM_Notes__c: null,
  SE_Next_Steps__c: 'Schedule executive sync',
  Sales_Engineer__c: '0050g000005z5SbAAI',
  // Added 2026-04-28 (PR-A1): mapper.ts requires the resolver so the UI
  // surfaces the SE's human name. Base fixture leaves it null to keep
  // the existing fallback-to-Id assertion at :165 valid; resolver-happy
  // -path coverage is added below.
  Sales_Engineer__r: null,
  Full_Churn_Notification_to_Owner_Date__c: null,
  Full_Churn_Final_Email_Sent_Date__c: null,
  Churn_Downsell_Reason__c: null,
  Churn_Destription__c: null,
  Product_Line__c: 'Core Zuora',
};

describe('mapOpportunity', () => {
  it('maps every SF-owned canonical field from a populated row', () => {
    const out = mapOpportunity(SAMPLE_OPP_ROW, CTX);
    expect(out.opportunityId).toBe('006Po00001F2TRNIA3');
    expect(out.opportunityName).toBe('Stenograph - Billing Volume');
    expect(out.accountId).toBe('0017000000abc123');
    expect(out.type).toBe('Amendment');
    expect(out.stageName).toBe('5.0 Propose');
    expect(out.stageNum).toBe(5);
    expect(out.closeDate).toBe('2026-04-28');
    expect(out.closeQuarter).toBe('Q1');
    expect(out.fiscalYear).toBe(2027);
    expect(out.acv).toBe(10500);
    expect(out.availableToRenewUSD).toBe(10500); // fallback to fml_Derived
    expect(out.forecastMostLikely).toBe(10500);
    expect(out.mostLikelyConfidence).toBe('Medium');
    expect(out.scNextSteps).toBe('Schedule executive sync');
    expect(out.salesEngineer).toEqual({ id: '0050g000005z5SbAAI', name: '0050g000005z5SbAAI' });
    expect(out.productLine).toBe('Core Zuora');
    expect(out.sourceLinks).toEqual([
      {
        source: 'salesforce',
        label: 'SFDC Opportunity',
        url: 'https://zuora.my.salesforce.com/lightning/r/Opportunity/006Po00001F2TRNIA3/view',
      },
    ]);
    expect(out.lastUpdated).toBe(REFRESH_AT.toISOString());
    expect(out.lastFetchedFromSource).toEqual({ salesforce: REFRESH_AT.toISOString() });
  });

  it('parses Stage_Num__c when supplied as a string like "5.0"', () => {
    const out = mapOpportunity({ ...SAMPLE_OPP_ROW, Stage_Num__c: '5.0' }, CTX);
    expect(out.stageNum).toBe(5);
  });

  it('returns null stageNum for unparseable values', () => {
    const out = mapOpportunity({ ...SAMPLE_OPP_ROW, Stage_Num__c: 'wat' }, CTX);
    expect(out.stageNum).toBeNull();
  });

  it('falls back through the ATR field hierarchy', () => {
    const out = mapOpportunity(
      {
        ...SAMPLE_OPP_ROW,
        Available_to_Renew_USD__c: 999,
        fml_DerivedAvailableToRenew__c: 100,
        Available_to_Renew_Local__c: 50,
      },
      CTX,
    );
    expect(out.availableToRenewUSD).toBe(999);
  });

  it('returns null mostLikelyConfidence for unknown picklist values', () => {
    const out = mapOpportunity({ ...SAMPLE_OPP_ROW, Most_Likely_Confidence__c: 'Maybe' }, CTX);
    expect(out.mostLikelyConfidence).toBeNull();
  });

  // PR-C1 — F-22 regression: a non-canonical-cased picklist value
  // ('confirmed', 'CONFIRMED ') must still normalize to the canonical
  // 'Confirmed', otherwise downstream `=== 'Confirmed'` comparisons
  // (forecast generator, dashboard counters) silently miss the row.
  it.each(['confirmed', 'CONFIRMED', '  Confirmed  '])(
    'normalizes mostLikelyConfidence "%s" to canonical "Confirmed" (F-22)',
    (raw) => {
      const out = mapOpportunity(
        { ...SAMPLE_OPP_ROW, Most_Likely_Confidence__c: raw },
        CTX,
      );
      expect(out.mostLikelyConfidence).toBe('Confirmed');
    },
  );

  // PR-C1 — F-21 regression: jsforce can emit Stage_Num__c as a
  // comma-decimal under non-en_US locales. parseStage must accept that
  // and produce the same numeric we'd get from the en_US "5.0".
  it('parses Stage_Num__c with a comma decimal locale (F-21)', () => {
    const out = mapOpportunity(
      { ...SAMPLE_OPP_ROW, Stage_Num__c: '5,0' },
      CTX,
    );
    expect(out.stageNum).toBe(5);
  });

  it('strips datetime suffix from churn dates', () => {
    const out = mapOpportunity(
      {
        ...SAMPLE_OPP_ROW,
        Full_Churn_Notification_to_Owner_Date__c: '2026-04-23T19:13:46.000+0000',
      },
      CTX,
    );
    expect(out.fullChurnNotificationToOwnerDate).toBe('2026-04-23');
  });

  it('resolves salesEngineer.name from Sales_Engineer__r.Name when present', () => {
    const out = mapOpportunity(
      { ...SAMPLE_OPP_ROW, Sales_Engineer__r: { Name: 'John Roe' } },
      CTX,
    );
    expect(out.salesEngineer).toEqual({
      id: '0050g000005z5SbAAI',
      name: 'John Roe',
    });
  });
});

describe('mapWorkshop', () => {
  it('maps a workshop row preserving the org\'s Status__c custom field', () => {
    const row: SfdcWorkshopRow = {
      Id: 'a01000000000001',
      Account__c: '0017000000abc123',
      Engagement_Type__c: 'Architecture Review',
      Status__c: 'Completed',
      Completion_Date__c: '2026-03-15T00:00:00.000+0000',
    };
    expect(mapWorkshop(row)).toEqual({
      id: 'a01000000000001',
      engagementType: 'Architecture Review',
      status: 'Completed',
      workshopDate: '2026-03-15',
    });
  });
});

describe('groupWorkshopsByAccount', () => {
  it('buckets workshops by Account__c', () => {
    const rows: SfdcWorkshopRow[] = [
      { Id: 'w1', Account__c: 'a1', Engagement_Type__c: 'Arch', Status__c: 'Completed', Completion_Date__c: '2026-01-01' },
      { Id: 'w2', Account__c: 'a1', Engagement_Type__c: 'Onboarding', Status__c: 'Scheduled', Completion_Date__c: '2026-02-01' },
      { Id: 'w3', Account__c: 'a2', Engagement_Type__c: 'QBR', Status__c: 'Completed', Completion_Date__c: '2026-03-01' },
    ];
    const grouped = groupWorkshopsByAccount(rows);
    expect(grouped.get('a1')).toHaveLength(2);
    expect(grouped.get('a2')).toHaveLength(1);
    expect(grouped.get('a3')).toBeUndefined();
  });
});

describe('applyOpportunityChurnSummary', () => {
  it('projects Opportunity.Churn_Destription__c onto Account.churnReasonSummary', () => {
    const accounts = new Map<string, Partial<CanonicalAccount>>();
    accounts.set('a1', { accountId: 'a1', accountName: 'Acme' });
    accounts.set('a2', { accountId: 'a2', accountName: 'Beta' });

    const opps: SfdcOpportunityRow[] = [
      { ...SAMPLE_OPP_ROW, Id: 'o1', AccountId: 'a1', Churn_Destription__c: null },
      {
        ...SAMPLE_OPP_ROW,
        Id: 'o2',
        AccountId: 'a1',
        Churn_Destription__c: 'Customer consolidating spend',
      },
      { ...SAMPLE_OPP_ROW, Id: 'o3', AccountId: 'a2', Churn_Destription__c: null },
    ];

    applyOpportunityChurnSummary(accounts, opps);
    expect(accounts.get('a1')?.churnReasonSummary).toBe('Customer consolidating spend');
    expect(accounts.get('a2')?.churnReasonSummary).toBeUndefined();
  });

  it('uses the latest non-empty value when multiple opps have summaries', () => {
    const accounts = new Map<string, Partial<CanonicalAccount>>();
    accounts.set('a1', { accountId: 'a1', accountName: 'Acme' });

    const opps: SfdcOpportunityRow[] = [
      { ...SAMPLE_OPP_ROW, Id: 'o1', AccountId: 'a1', Churn_Destription__c: 'Earlier reason' },
      { ...SAMPLE_OPP_ROW, Id: 'o2', AccountId: 'a1', Churn_Destription__c: 'Latest reason' },
    ];

    applyOpportunityChurnSummary(accounts, opps);
    expect(accounts.get('a1')?.churnReasonSummary).toBe('Latest reason');
  });
});
