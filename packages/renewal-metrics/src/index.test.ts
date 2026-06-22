import { describe, expect, it } from 'vitest';
import type { AccountView, CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import {
  buildRenewalAccountRows,
  buildRenewalMetrics,
  buildRenewalOppRows,
  classifyRenewalOutcome,
  deriveRenewedRevenueUSD,
  filterAtRiskByOverallAssessment,
  filterUpcomingRenewals,
  isKnownChurnOpportunity,
  isOverallAssessmentAtRisk,
  type RenewalOppRow,
} from './index.js';

const AS_OF = '2026-06-16';

function mkAccount(over: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: 'A1',
    salesforceAccountId: 'SF1',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: { id: 'O1', name: 'Owner One' },
    assignedCSE: { id: 'C1', name: 'CSE One' },
    csCoverage: 'CSE',
    franchise: 'Expand 3',
    cseSentiment: 'Green',
    cseSentimentCommentary: null,
    cseSentimentLastUpdated: null,
    cseSentimentCommentaryLastUpdated: null,
    cerebroRiskCategory: 'Low',
    cerebroRiskAnalysis: null,
    cerebroRisks: {
      utilizationRisk: null,
      engagementRisk: null,
      suiteRisk: null,
      shareRisk: null,
      legacyTechRisk: null,
      expertiseRisk: null,
      pricingRisk: null,
    },
    cerebroSubMetrics: {},
    allTimeARR: 500_000,
    activeProductLines: [],
    engagementMinutes30d: 100,
    engagementMinutes90d: 300,
    isConfirmedChurn: false,
    churnReason: null,
    churnReasonSummary: null,
    churnDate: null,
    gainsightTasks: [],
    workshops: [],
    recentMeetings: [],
    accountPlanLinks: [],
    sourceLinks: [],
    lastUpdated: AS_OF,
    ...over,
  };
}

function mkOpp(over: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
  return {
    opportunityId: 'O1',
    opportunityName: 'Renewal 2027',
    accountId: 'A1',
    type: 'Existing Business - Renewal',
    stageName: '4.0 Propose',
    stageNum: 4,
    closeDate: '2026-04-15',
    closeQuarter: '2027-Q1',
    fiscalYear: 2027,
    acv: null,
    availableToRenewUSD: 100_000,
    forecastMostLikely: 0,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: null,
    forecastHedgeUSD: null,
    acvDelta: 0,
    knownChurnUSD: null,
    productLine: 'Billing',
    flmNotes: null,
    slmNotes: null,
    scNextSteps: null,
    salesEngineer: null,
    fullChurnNotificationToOwnerDate: null,
    fullChurnFinalEmailSentDate: null,
    churnDownsellReason: null,
    sourceLinks: [],
    lastUpdated: AS_OF,
    ...over,
  };
}

function mkView(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
  over: Partial<AccountView> = {},
): AccountView {
  return {
    account,
    opportunities: opps,
    bucket: 'Healthy',
    risk: { level: 'Low', source: 'cerebro', rationale: '' },
    upsell: { score: 0, band: 'Watch', signals: [] },
    hygiene: { score: 0, violations: [] },
    priorityRank: 1,
    daysToRenewal: 90,
    atrUSD: opps.reduce((s, o) => s + (o.availableToRenewUSD ?? 0), 0),
    acvAtRiskUSD: 0,
    changeEvents: [],
    ...over,
  };
}

const quarterKeyFn = (iso: string | null | undefined) => {
  if (!iso) return null;
  if (iso.startsWith('2026-04')) return '2027-Q1';
  if (iso.startsWith('2026-07')) return '2027-Q2';
  return null;
};

describe('deriveRenewedRevenueUSD', () => {
  it('returns 0 for confirmed full churn via churnRisk', () => {
    const view = mkView(mkAccount(), [mkOpp({ churnRisk: 'Confirmed Full Churn' })]);
    expect(deriveRenewedRevenueUSD(view.opportunities[0]!, view)).toBe(0);
  });

  it('returns ATR for flat open renewal', () => {
    const view = mkView(mkAccount(), [mkOpp({ forecastMostLikely: 0, acvDelta: 0 })]);
    expect(deriveRenewedRevenueUSD(view.opportunities[0]!, view)).toBe(100_000);
  });

  it('returns ATR + negative ML for downsell forecast', () => {
    const view = mkView(mkAccount(), [mkOpp({ forecastMostLikely: -30_000 })]);
    expect(deriveRenewedRevenueUSD(view.opportunities[0]!, view)).toBe(70_000);
  });

  it('uses closed-won ACV when set as post-renewal total', () => {
    const view = mkView(
      mkAccount(),
      [
        mkOpp({
          stageName: '8.0 - Closed/Won (Finance)',
          forecastCategory: 'Closed Won',
          acv: 85_000,
          acvDelta: null,
        }),
      ],
    );
    expect(deriveRenewedRevenueUSD(view.opportunities[0]!, view)).toBe(85_000);
  });

  it('uses ATR + acvDelta when SFDC duplicates delta into ACV (production Vocera pattern)', () => {
    const view = mkView(
      mkAccount(),
      [
        mkOpp({
          stageName: '8.0 - Closed/Won (Finance)',
          availableToRenewUSD: 227_461,
          acv: 49_745.81,
          acvDelta: 49_745.81,
        }),
      ],
    );
    expect(deriveRenewedRevenueUSD(view.opportunities[0]!, view)).toBeCloseTo(277_206.81, 0);
  });

  it('uses ATR + acvDelta for closed won without ACV', () => {
    const view = mkView(
      mkAccount(),
      [
        mkOpp({
          stageName: 'Closed Won',
          acvDelta: 20_000,
          acv: null,
        }),
      ],
    );
    expect(deriveRenewedRevenueUSD(view.opportunities[0]!, view)).toBe(120_000);
  });

  it('returns 0 for closed lost', () => {
    const view = mkView(
      mkAccount(),
      [mkOpp({ stageName: 'Closed Lost', forecastCategory: 'Closed Lost' })],
    );
    expect(deriveRenewedRevenueUSD(view.opportunities[0]!, view)).toBe(0);
  });

  it('does not zero revenue for churn notice dates without Confirmed Full Churn', () => {
    const opp = mkOpp({
      churnRisk: 'At Risk',
      fullChurnNotificationToOwnerDate: '2026-04-01',
      forecastMostLikely: 0,
    });
    const view = mkView(mkAccount(), [opp]);
    expect(deriveRenewedRevenueUSD(opp, view)).toBe(100_000);
  });
});

describe('classifyRenewalOutcome', () => {
  it('classifies full churn', () => {
    const opp = mkOpp({ churnRisk: 'Confirmed Full Churn', stageName: 'Closed Lost' });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('full_churn');
  });

  it('classifies closed downsell', () => {
    const opp = mkOpp({
      forecastMostLikely: -25_000,
      stageName: '8.0 - Closed/Won (Finance)',
      acv: 75_000,
      acvDelta: -25_000,
    });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('downsell');
  });

  it('classifies open forecast downsell as pending not closed downsell', () => {
    const opp = mkOpp({ forecastMostLikely: -25_000, closeDate: '2026-08-01' });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('pending');
  });

  it('classifies open 100% loss forecast as pending not full churn', () => {
    const opp = mkOpp({ forecastMostLikely: -100_000, closeDate: '2026-08-01' });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('pending');
  });

  it('does not classify churn notice alone as full churn on open opp', () => {
    const opp = mkOpp({
      churnRisk: 'At Risk',
      fullChurnNotificationToOwnerDate: '2026-04-01',
      forecastMostLikely: -100_000,
      closeDate: '2026-08-01',
    });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('pending');
  });

  it('classifies expansion', () => {
    const opp = mkOpp({
      stageName: 'Closed Won',
      acvDelta: 15_000,
      acv: 115_000,
    });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('expanded');
  });

  it('classifies pending open renewal', () => {
    const opp = mkOpp({ closeDate: '2026-08-01' });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('pending');
  });

  it('classifies pushed when close date passed but still open', () => {
    const opp = mkOpp({ closeDate: '2026-05-01', stageName: '4.0 Propose' });
    const view = mkView(mkAccount(), [opp]);
    expect(classifyRenewalOutcome(opp, view, AS_OF)).toBe('pushed');
  });
});

describe('buildRenewalMetrics', () => {
  it('aggregates KPIs and reconciles drilldown with summary', () => {
    const fullChurn = mkView(
      mkAccount({ accountId: 'FC', accountName: 'Full Churn Co' }),
      [mkOpp({ accountId: 'FC', opportunityId: 'O-FC', churnRisk: 'Confirmed Full Churn', availableToRenewUSD: 200_000, knownChurnUSD: 200_000 })],
      { bucket: 'Confirmed Churn' },
    );
    const downsell = mkView(
      mkAccount({ accountId: 'DS', accountName: 'Downsell Co' }),
      [mkOpp({ accountId: 'DS', opportunityId: 'O-DS', forecastMostLikely: -40_000, availableToRenewUSD: 100_000 })],
    );
    const flat = mkView(
      mkAccount({ accountId: 'FL', accountName: 'Flat Co' }),
      [mkOpp({ accountId: 'FL', opportunityId: 'O-FL', availableToRenewUSD: 80_000, forecastMostLikely: 0 })],
    );
    const expanded = mkView(
      mkAccount({ accountId: 'EX', accountName: 'Expand Co' }),
      [
        mkOpp({
          accountId: 'EX',
          opportunityId: 'O-EX',
          availableToRenewUSD: 50_000,
          stageName: 'Closed Won',
          acv: 60_000,
        }),
      ],
    );

    const metrics = buildRenewalMetrics({
      views: [fullChurn, downsell, flat, expanded],
      quarterKeys: new Set(['2027-Q1']),
      quarterKeyFn,
      asOfDate: AS_OF,
    });

    const oppRows = buildRenewalOppRows(
      [fullChurn, downsell, flat, expanded],
      new Set(['2027-Q1']),
      quarterKeyFn,
      AS_OF,
    );
    const accountRows = buildRenewalAccountRows(oppRows, AS_OF);

    expect(metrics.accountsUpForRenewal).toBe(3);
    expect(metrics.atrUpForRenewalUSD).toBe(230_000);
    expect(metrics.atrChurnedUSD).toBe(0);
    expect(metrics.downsellAmountUSD).toBe(40_000);
    expect(metrics.fullChurnAccountCount).toBe(0);
    expect(metrics.downsellAccountCount).toBe(0);
    expect(metrics.outcomeCounts.pushed).toBe(2);
    expect(metrics.openRenewalCount).toBe(2);
    expect(metrics.openRenewalAtrUSD).toBe(180_000);
    expect(metrics.knownChurn.accountCount).toBe(1);
    expect(metrics.knownChurn.opportunityCount).toBe(1);
    expect(metrics.knownChurn.atrUSD).toBe(200_000);
    expect(metrics.knownChurn.knownChurnUSD).toBe(200_000);
    expect(metrics.grossRevenueRetentionPct).toBeCloseTo(
      accountRows.reduce((s, a) => s + a.renewedRevenueUSD, 0) / 230_000,
    );

    // Summary must match drilldown roll-ups
    expect(metrics.atrUpForRenewalUSD).toBe(
      accountRows.reduce((s, a) => s + a.atrUSD, 0),
    );
    expect(metrics.renewedRevenueUSD).toBe(
      accountRows.reduce((s, a) => s + a.renewedRevenueUSD, 0),
    );
  });

  it('handles multi-opp account in same quarter', () => {
    const view = mkView(mkAccount(), [
      mkOpp({ opportunityId: 'O-A', availableToRenewUSD: 50_000, forecastMostLikely: 0 }),
      mkOpp({
        opportunityId: 'O-B',
        availableToRenewUSD: 30_000,
        closeDate: '2026-04-20',
        forecastMostLikely: -10_000,
      }),
    ]);
    const rows = buildRenewalAccountRows(
      buildRenewalOppRows([view], new Set(['2027-Q1']), quarterKeyFn, AS_OF),
      AS_OF,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.atrUSD).toBe(80_000);
    expect(rows[0]!.renewedRevenueUSD).toBe(70_000);
    expect(rows[0]!.opportunityCount).toBe(2);
  });

  it('excludes non-renewal opps', () => {
    const view = mkView(mkAccount(), [
      mkOpp({ type: 'Amendment', availableToRenewUSD: 999_000 }),
    ]);
    const rows = buildRenewalOppRows([view], null, () => '2027-Q1', AS_OF);
    expect(rows).toHaveLength(0);
  });

  it('keeps known churn out of saveable renewal metrics', () => {
    const view = mkView(mkAccount(), [
      mkOpp({ opportunityId: 'O1', churnRisk: 'Confirmed Full Churn', availableToRenewUSD: 100_000 }),
      mkOpp({
        opportunityId: 'O2',
        availableToRenewUSD: 50_000,
        forecastMostLikely: -10_000,
        closeDate: '2026-04-20',
      }),
    ]);
    const metrics = buildRenewalMetrics({
      views: [view],
      quarterKeys: new Set(['2027-Q1']),
      quarterKeyFn,
      asOfDate: AS_OF,
    });
    expect(metrics.knownChurn.opportunityCount).toBe(1);
    expect(metrics.accountsUpForRenewal).toBe(1);
    expect(metrics.atrUpForRenewalUSD).toBe(50_000);
  });

  it('does not treat knownChurnUSD alone as known churn', () => {
    const view = mkView(mkAccount(), [
      mkOpp({ knownChurnUSD: 100_000, availableToRenewUSD: 100_000 }),
    ]);
    const metrics = buildRenewalMetrics({
      views: [view],
      quarterKeys: new Set(['2027-Q1']),
      quarterKeyFn,
      asOfDate: AS_OF,
    });
    expect(metrics.knownChurn.opportunityCount).toBe(0);
    expect(metrics.atrUpForRenewalUSD).toBe(100_000);
  });

  it('requires Confirmed Full Churn for known churn, not notice dates alone', () => {
    const opp = mkOpp({
      churnRisk: 'At Risk',
      fullChurnNotificationToOwnerDate: '2026-04-01',
    });
    expect(isKnownChurnOpportunity(opp)).toBe(false);
  });

  it('rejects Confirmed Full Churn when Sub-type is not Full Churn', () => {
    const opp = mkOpp({ churnRisk: 'Confirmed Full Churn', subType: 'Downsell' });
    expect(isKnownChurnOpportunity(opp)).toBe(false);
  });

  it('accepts Confirmed Full Churn with Full Churn sub-type', () => {
    const opp = mkOpp({ churnRisk: 'Confirmed Full Churn', subType: 'Full Churn' });
    expect(isKnownChurnOpportunity(opp)).toBe(true);
  });
});

describe('overall assessment at-risk filters', () => {
  const row = (partial: Partial<RenewalOppRow>): RenewalOppRow =>
    ({
      opportunityId: 'O1',
      opportunityName: 'Renewal',
      accountId: 'A1',
      accountName: 'Acct',
      cseName: null,
      accountOwner: null,
      cseSentiment: null,
      closeDate: '2026-08-01',
      stageName: 'Open',
      renewalStatus: 'Open',
      atrUSD: 100_000,
      renewedRevenueUSD: 100_000,
      churnedAtrUSD: 0,
      downsellAmountUSD: 0,
      downsellPct: null,
      forecastMostLikelyUSD: null,
      outcome: 'pending',
      overallAssessment: null,
      overallAssessmentDetail: null,
      healthScore: null,
      healthBand: null,
      riskScoreConfidence: null,
      riskSignals: [],
      usageIndicator: null,
      reason: null,
      nextStep: null,
      lastActivityDate: null,
      daysSinceSlackUpdate: null,
      slackLastTouch: null,
      daysSinceCustomerEngagement: null,
      customerEngagementLastTouch: null,
      salesforceUrl: null,
      opportunitySalesforceUrl: null,
      ...partial,
    }) as RenewalOppRow;

  it('flags Critical and High open renewals as at-risk', () => {
    expect(isOverallAssessmentAtRisk('Critical')).toBe(true);
    expect(isOverallAssessmentAtRisk('High')).toBe(true);
    expect(isOverallAssessmentAtRisk('Medium')).toBe(false);
    const rows = [
      row({ opportunityId: '1', overallAssessment: 'Critical' }),
      row({ opportunityId: '2', overallAssessment: 'High' }),
      row({ opportunityId: '3', overallAssessment: 'Medium' }),
      row({ opportunityId: '4', overallAssessment: 'Critical', outcome: 'full_churn' }),
    ];
    expect(filterAtRiskByOverallAssessment(rows).map((r) => r.opportunityId)).toEqual(['1', '2']);
  });

  it('filters upcoming renewals by close date horizon', () => {
    const asOf = '2026-06-22T12:00:00.000Z';
    const rows = [
      row({ opportunityId: 'soon', closeDate: '2026-07-01' }),
      row({ opportunityId: 'later', closeDate: '2026-12-01' }),
      row({ opportunityId: 'closed', closeDate: '2026-07-01', outcome: 'flat' }),
    ];
    expect(filterUpcomingRenewals(rows, 30, asOf).map((r) => r.opportunityId)).toEqual(['soon']);
  });
});
