import { describe, expect, it } from 'vitest';
import {
  parseClariManagerForecastExportCsv,
  parseClariNumericDataValue,
  selectLatestClariForecastValue,
  timeframeMatchesFiscalQuarter,
} from './clari-manager-forecast';
import { generateWeeklyForecast } from './index';
import type {
  AccountView,
  CanonicalAccount,
  CanonicalOpportunity,
} from '@mdas/canonical';

/** Minimal export shaped like the manager’s Clari file (FY27 Q2). */
const FY27_Q2_CLARI_FIXTURE = `User,Email,CRM User ID,Role,Parent Role,Timeframe,Field,Week,Start Day,End Day,Data Type,Data Value
Nick,nick@example.com,U1,FLM Expand 3,,FY27 Q2,Churn/Downsell Flash,1,04/28/2026,05/04/2026,Forecast Value,-2400000.0
Nick,nick@example.com,U1,FLM Expand 3,,FY27 Q2,Churn/Downsell Flash,3,05/12/2026,05/18/2026,Forecast Value,-2473435.0
Nick,nick@example.com,U1,FLM Expand 3,,FY27 Q2,Churn/Downsell Flash,4,05/19/2026,05/25/2026,Forecast Value,
Nick,nick@example.com,U1,FLM Expand 3,,FY27 Q2,Churn/Downsell Flash,5,05/26/2026,06/01/2026,Forecast Value,
Nick,nick@example.com,U1,FLM Expand 3,,FY27 Q2,Churn/Downsell Flash,3,05/12/2026,05/18/2026,Forecast Updated,Yes
Nick,nick@example.com,U1,FLM Expand 3,,FY27 Q2,Churn/Downsell Plan,3,05/12/2026,05/18/2026,Forecast Value,-2164000.0
Nick,nick@example.com,U1,FLM Expand 3,,FY27 Q2,Hedge,3,05/12/2026,05/18/2026,Forecast Value,95000.0
Other,other@example.com,U2,Other Role,,FY27 Q2,Churn/Downsell Flash,9,05/12/2026,05/18/2026,Forecast Value,-99999999
`;

describe('parseClariNumericDataValue', () => {
  it('parses signed decimals and comma thousands', () => {
    expect(parseClariNumericDataValue('-2473435.0')).toBe(-2473435);
    expect(parseClariNumericDataValue('-2,473,435')).toBe(-2473435);
  });

  it('returns null for blanks and Forecast Updated Yes/No', () => {
    expect(parseClariNumericDataValue('')).toBeNull();
    expect(parseClariNumericDataValue('   ')).toBeNull();
    expect(parseClariNumericDataValue('Yes')).toBeNull();
    expect(parseClariNumericDataValue('No')).toBeNull();
  });
});

describe('parseClariManagerForecastExportCsv + selectLatestClariForecastValue', () => {
  it('selects the latest populated Churn/Downsell Flash Forecast Value for FY27 Q2', () => {
    const rows = parseClariManagerForecastExportCsv(FY27_Q2_CLARI_FIXTURE);
    const sel = selectLatestClariForecastValue(rows, {
      role: 'FLM Expand 3',
      timeframeMatches: (tf) => timeframeMatchesFiscalQuarter(tf, '2027-Q2'),
      field: 'Churn/Downsell Flash',
      dataType: 'Forecast Value',
    });
    expect(sel?.clariForecastValue).toBe(-2473435);
    expect(sel?.clariForecastWeek).toBe(3);
    expect(sel?.clariForecastStartDay).toBe('05/12/2026');
    expect(sel?.clariForecastEndDay).toBe('05/18/2026');
  });

  it('does not let blank later weeks override week 3', () => {
    const rows = parseClariManagerForecastExportCsv(FY27_Q2_CLARI_FIXTURE);
    const sel = selectLatestClariForecastValue(rows, {
      role: 'FLM Expand 3',
      timeframeMatches: (tf) => timeframeMatchesFiscalQuarter(tf, '2027-Q2'),
      field: 'Churn/Downsell Flash',
      dataType: 'Forecast Value',
    });
    expect(sel?.clariForecastValue).not.toBe(-2400000);
    expect(sel?.clariForecastWeek).toBe(3);
  });

  it('never selects Forecast Updated rows as dollars', () => {
    const rows = parseClariManagerForecastExportCsv(FY27_Q2_CLARI_FIXTURE);
    const updatedOnly = rows.filter((r) => r.dataType === 'Forecast Updated');
    expect(updatedOnly.length).toBeGreaterThan(0);
    const sel = selectLatestClariForecastValue(updatedOnly, {
      role: 'FLM Expand 3',
      timeframeMatches: () => true,
      field: 'Churn/Downsell Flash',
      dataType: 'Forecast Value',
    });
    expect(sel).toBeNull();
  });

  it('matches timeframe "Q2" to fiscal key 2027-Q2', () => {
    expect(timeframeMatchesFiscalQuarter('Q2', '2027-Q2')).toBe(true);
    expect(timeframeMatchesFiscalQuarter('Q3', '2027-Q2')).toBe(false);
  });
});

describe('generateWeeklyForecast + Clari', () => {
  const REFRESH_AT = '2026-05-13T12:00:00.000Z';

  function mkAccount(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
    return {
      accountId: 'A1',
      salesforceAccountId: '001',
      accountName: 'Noise Co',
      zuoraTenantId: null,
      accountOwner: null,
      assignedCSE: null,
      csCoverage: 'CSE',
      franchise: 'Expand 3',
      cseSentiment: 'Green',
      cseSentimentCommentary: null,
      cseSentimentLastUpdated: null,
      cseSentimentCommentaryLastUpdated: null,
      cerebroRiskCategory: 'Low',
      cerebroRiskAnalysis: null,
      cerebroRisks: {
        utilizationRisk: false,
        engagementRisk: false,
        suiteRisk: false,
        shareRisk: false,
        legacyTechRisk: false,
        expertiseRisk: false,
        pricingRisk: false,
      },
      cerebroSubMetrics: {},
      allTimeARR: 1,
      activeProductLines: [],
      engagementMinutes30d: null,
      engagementMinutes90d: null,
      isConfirmedChurn: false,
      churnReason: null,
      churnReasonSummary: null,
      churnDate: null,
      gainsightTasks: [],
      workshops: [],
      recentMeetings: [],
      accountPlanLinks: [],
      sourceLinks: [],
      lastUpdated: REFRESH_AT,
      ...overrides,
    };
  }

  function mkOpp(o: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
    return {
      opportunityId: 'O1',
      opportunityName: 'Renewal',
      accountId: 'A1',
      type: 'Renewal',
      stageName: 'S',
      stageNum: 1,
      closeDate: '2026-06-15',
      closeQuarter: 'Q2',
      fiscalYear: 2027,
      acv: 5_000_000,
      availableToRenewUSD: 5_000_000,
      forecastMostLikely: -50_000,
      forecastMostLikelyOverride: null,
      bestCaseUSD: null,
      mostLikelyConfidence: null,
      forecastHedgeUSD: 400_000,
      acvDelta: 0,
      knownChurnUSD: 0,
      productLine: null,
      flmNotes: null,
      slmNotes: null,
      scNextSteps: null,
      salesEngineer: null,
      fullChurnNotificationToOwnerDate: null,
      fullChurnFinalEmailSentDate: null,
      churnDownsellReason: null,
      sourceLinks: [],
      lastUpdated: REFRESH_AT,
      ...o,
    };
  }

  function mkView(a: CanonicalAccount, opps: CanonicalOpportunity[]): AccountView {
    return {
      account: a,
      opportunities: opps,
      bucket: 'Saveable Risk',
      risk: { level: 'High', source: 'cerebro', rationale: '' },
      upsell: { score: 0, band: 'Watch', signals: [] },
      hygiene: { score: 0, violations: [] },
      priorityRank: 1,
      daysToRenewal: 1,
      atrUSD: 5_000_000,
      acvAtRiskUSD: 0,
      changeEvents: [],
    };
  }

  it('uses Clari Flash for the headline even when account roll-ups disagree', () => {
    const view = mkView(mkAccount(), [mkOpp()]);
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-05-13',
      clariManagerForecastCsv: FY27_Q2_CLARI_FIXTURE,
    });
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: -\$2,473,435/);
    expect(md).not.toMatch(/Churn\/Downsell Flash \/ Most Likely: -\$50,000/);
  });

  it('fills Plan / Gap / Hedge from Clari Forecast Value rows when present', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: '2026-05-13',
      clariManagerForecastCsv: FY27_Q2_CLARI_FIXTURE,
    });
    expect(md).toMatch(/Churn\/Downsell Plan: -\$2,164,000/);
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: -\$2,473,435/);
    expect(md).toMatch(/Gap to Plan: -\$309,435/);
    expect(md).toMatch(/Hedge: \$95,000/);
  });
});
