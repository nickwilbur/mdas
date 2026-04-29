// Unit tests for the Clari-paste CSV exporter and dark-account detector.
// Audit ref: §4.7 / PR-C3.
import { describe, expect, it } from 'vitest';
import type { AccountView, CanonicalAccount, CanonicalOpportunity } from '@mdas/canonical';
import { generateClariCsv, findDarkAccounts } from './clari-csv.js';

const NOW = Date.parse('2026-04-28T18:00:00.000Z');
const DAY = 86_400_000;

function mkAccount(o: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: 'A1',
    salesforceAccountId: 'SFID',
    accountName: 'Acme',
    zuoraTenantId: null,
    accountOwner: null,
    assignedCSE: { id: 'U-CSE-1', name: 'Jane Doe' },
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
    allTimeARR: 100_000,
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
    lastUpdated: new Date(NOW).toISOString(),
    ...o,
  };
}

function mkOpp(o: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
  return {
    opportunityId: 'O1',
    opportunityName: 'A Renewal',
    accountId: 'A1',
    type: 'Renewal',
    stageName: 'Qualification',
    stageNum: 2,
    closeDate: '2026-09-30',
    closeQuarter: 'Q3',
    fiscalYear: 2027,
    acv: 100_000,
    availableToRenewUSD: 100_000,
    forecastMostLikely: 100_000,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: 'Medium',
    forecastHedgeUSD: 0,
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
    lastUpdated: new Date(NOW).toISOString(),
    ...o,
  };
}

function mkView(account: CanonicalAccount, opps: CanonicalOpportunity[], over: Partial<AccountView> = {}): AccountView {
  return {
    account,
    opportunities: opps,
    bucket: 'Healthy',
    risk: { level: 'Low', source: 'cerebro', rationale: '' },
    upsell: { score: 0, band: 'Watch', signals: [] },
    hygiene: { score: 0, violations: [] },
    priorityRank: 1,
    daysToRenewal: 60,
    atrUSD: 100_000,
    acvAtRiskUSD: 0,
    changeEvents: [],
    ...over,
  };
}

describe('generateClariCsv', () => {
  it('emits a header row + one row per forecastable opp by default', () => {
    const v = mkView(mkAccount({ accountName: 'Acme Corp' }), [
      mkOpp({ type: 'Renewal' }),
      mkOpp({ opportunityId: 'O2', type: 'Upsell', acv: 50_000 }),
      mkOpp({ opportunityId: 'O3', type: 'New Business' }),
    ]);
    const csv = generateClariCsv([v]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('"Account"');
    // 1 header + 2 forecastable opps (Renewal + Upsell), New Business filtered out.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Acme Corp"');
    // The Upsell row is the second data row.
    expect(lines[2]).toContain('"Acme Corp"');
  });

  it('escapes embedded double quotes per RFC 4180', () => {
    const v = mkView(mkAccount({ accountName: 'Acme "Quoted" Inc.' }), [mkOpp()]);
    const csv = generateClariCsv([v]);
    expect(csv).toContain('"Acme ""Quoted"" Inc."');
  });

  it('forecastableOnly=false includes every opp regardless of type', () => {
    const v = mkView(mkAccount(), [
      mkOpp({ type: 'New Business' }),
      mkOpp({ opportunityId: 'O2', type: 'Renewal' }),
    ]);
    const csv = generateClariCsv([v], { forecastableOnly: false });
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 opps
  });

  it('emits an empty cell for null numerics so Excel does not show 0', () => {
    const v = mkView(mkAccount(), [mkOpp({ acv: null, forecastMostLikely: null })]);
    const csv = generateClariCsv([v]);
    expect(csv).toContain(',"","",'); // acv empty, forecastMostLikely empty
  });
});

describe('findDarkAccounts', () => {
  function recentMeetingAt(daysAgo: number) {
    return {
      source: 'calendar' as const,
      title: 'Sync',
      startTime: new Date(NOW - daysAgo * DAY).toISOString(),
      attendees: [] as string[],
      summary: null,
      url: null,
    };
  }

  it('returns accounts with no signal in the last windowDays', () => {
    const v1 = mkView(mkAccount({ accountId: 'A1', accountName: 'Quiet' }), []);
    const v2 = mkView(
      mkAccount({
        accountId: 'A2',
        accountName: 'Active',
        recentMeetings: [recentMeetingAt(2)],
      }),
      [],
    );
    const dark = findDarkAccounts([v1, v2], { windowDays: 7, now: NOW });
    expect(dark.map((d) => d.accountId)).toEqual(['A1']);
  });

  it('honors a recent workshop as a signal', () => {
    const v = mkView(
      mkAccount({
        recentMeetings: [],
        workshops: [
          { id: 'W1', engagementType: 'Health Check', status: 'Completed', workshopDate: new Date(NOW - 3 * DAY).toISOString() },
        ],
      }),
      [],
    );
    expect(findDarkAccounts([v], { now: NOW })).toHaveLength(0);
  });

  it('skips Confirmed Churn accounts (already done, not dark)', () => {
    const v = mkView(mkAccount({ accountId: 'A3', accountName: 'Done' }), [], {
      bucket: 'Confirmed Churn',
    });
    expect(findDarkAccounts([v], { now: NOW })).toHaveLength(0);
  });

  it('sorts dark accounts by ARR exposure descending', () => {
    const small = mkView(mkAccount({ accountId: 'S', accountName: 'Small', allTimeARR: 10_000 }), []);
    const big = mkView(mkAccount({ accountId: 'B', accountName: 'Big', allTimeARR: 1_000_000 }), []);
    const dark = findDarkAccounts([small, big], { now: NOW });
    expect(dark.map((d) => d.accountId)).toEqual(['B', 'S']);
  });
});
