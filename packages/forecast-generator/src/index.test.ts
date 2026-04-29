// Golden-file tests for generateWeeklyForecast.
//
// Audit ref: F-12 in docs/audit/01_findings.md.
//
// The forecast markdown is the artifact a manager pastes into Clari and
// circulates to leadership; a silent regression in the headline section
// or section ordering is high-cost. These tests pin the output shape
// against a small but realistic input — one Confirmed Churn account,
// one Saveable Risk account with WoW risk movement, one Healthy
// upsell-Hot account, plus a churn-notice change event.
//
// To intentionally update the goldens, change the assertions below.
// They're written as targeted toContain / toMatch checks rather than
// a single full-string snapshot so a one-line cosmetic change doesn't
// blow up every assertion at once.
import { describe, expect, it } from 'vitest';
import type {
  AccountView,
  CanonicalAccount,
  CanonicalOpportunity,
  ChangeEvent,
} from '@mdas/canonical';
import { generateWeeklyForecast } from './index.js';

const REFRESH_AT = '2026-04-28T18:00:00.000Z';

function mkAccount(overrides: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return {
    accountId: 'A1',
    salesforceAccountId: '0014u00001zmSSOAA2',
    accountName: 'Account A',
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
    activeProductLines: ['Zuora Billing'],
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

function mkOpportunity(
  overrides: Partial<CanonicalOpportunity> = {},
): CanonicalOpportunity {
  return {
    opportunityId: 'O1',
    opportunityName: 'Account A Renewal',
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
    productLine: 'Zuora Billing',
    flmNotes: null,
    slmNotes: null,
    scNextSteps: null,
    salesEngineer: null,
    fullChurnNotificationToOwnerDate: null,
    fullChurnFinalEmailSentDate: null,
    churnDownsellReason: null,
    sourceLinks: [],
    lastUpdated: REFRESH_AT,
    ...overrides,
  };
}

function mkView(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
  overrides: Partial<AccountView> = {},
): AccountView {
  return {
    account,
    opportunities: opps,
    bucket: 'Healthy',
    risk: { level: 'Low', source: 'cerebro', rationale: 'Cerebro Risk Category Low' },
    upsell: { score: 0, band: 'Watch', signals: [] },
    hygiene: { score: 0, violations: [] },
    priorityRank: 1,
    daysToRenewal: 60,
    atrUSD: 100_000,
    acvAtRiskUSD: 0,
    changeEvents: [],
    ...overrides,
  };
}

describe('generateWeeklyForecast', () => {
  it('renders the documented section headers in order', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: '2026-04-28',
    });
    const expectedSections = [
      '## Headline',
      '## Confirmed Churn — Movements This Week',
      '## Saveable Risk — Movements This Week',
      '## Upsell — Movements This Week',
      '## CSE Hygiene Call-Outs',
      '## Asks of Leadership',
      '## Talk Track (4–6 bullets for 1:1)',
      '## Source Evidence',
    ];
    let cursor = 0;
    for (const section of expectedSections) {
      const idx = md.indexOf(section, cursor);
      expect(idx, `expected section ${section} after position ${cursor}`).toBeGreaterThan(-1);
      cursor = idx + section.length;
    }
  });

  it('renders the title with the asOfDate and the audience', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: '2026-04-28',
      audience: 'My Leader',
    });
    expect(md).toContain('# Expand 3 Weekly Forecast Update — 2026-04-28');
    expect(md).toContain('_Audience: My Leader_');
  });

  it('lists Confirmed Churn accounts with their churn USD and reason', () => {
    const churnAcc = mkAccount({
      accountId: 'A1',
      accountName: 'Stenograph LLC',
      cseSentiment: 'Confirmed Churn',
      isConfirmedChurn: true,
      churnReasonSummary: 'Consolidating with competitor',
    });
    const churnOpp = mkOpportunity({
      opportunityId: 'O1',
      accountId: 'A1',
      knownChurnUSD: 250_000,
    });
    const view = mkView(churnAcc, [churnOpp], {
      bucket: 'Confirmed Churn',
    });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-04-28',
    });
    expect(md).toMatch(/\*\*Stenograph LLC\*\* — \$250,000, Consolidating with competitor/);
  });

  it('shows WoW risk movement for Saveable Risk accounts when an event exists', () => {
    const acc = mkAccount({
      accountId: 'A2',
      accountName: 'Acme Corp',
      cerebroRiskCategory: 'High',
      cseSentiment: 'Yellow',
    });
    const opp = mkOpportunity({ accountId: 'A2', scNextSteps: 'Schedule executive sync' });
    const view = mkView(acc, [opp], {
      bucket: 'Saveable Risk',
      risk: { level: 'High', source: 'cerebro', rationale: '' },
    });
    const event: ChangeEvent = {
      accountId: 'A2',
      field: 'cerebroRiskCategory',
      oldValue: 'Medium',
      newValue: 'High',
      occurredBetween: ['prev', 'curr'],
      category: 'risk',
      label: 'Cerebro Risk Category Medium → High',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [event],
      asOfDate: '2026-04-28',
    });
    expect(md).toContain('Risk Medium → High');
    expect(md).toContain('Acme Corp');
    expect(md).toContain('Schedule executive sync');
  });

  it('lists upsell Hot accounts in the Upsell section with their score', () => {
    const acc = mkAccount({ accountId: 'A3', accountName: 'BetaCo' });
    const opp = mkOpportunity({
      opportunityId: 'O3',
      accountId: 'A3',
      type: 'Upsell',
      acvDelta: 50_000,
    });
    const view = mkView(acc, [opp], {
      upsell: { score: 80, band: 'Hot', signals: [] },
    });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-04-28',
    });
    expect(md).toContain('BetaCo');
    expect(md).toContain('upsell 80');
    expect(md).toMatch(/ACV Δ \$50,000/);
  });

  it('rolls up Confirmed/Most-Likely/Hedge in the headline', () => {
    const acc = mkAccount({ accountId: 'A4' });
    const opp = mkOpportunity({
      accountId: 'A4',
      mostLikelyConfidence: 'Confirmed',
      forecastMostLikely: 200_000,
      forecastHedgeUSD: 50_000,
    });
    const view = mkView(acc, [opp]);
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-04-28',
    });
    expect(md).toContain('Confirmed $200,000');
    expect(md).toContain('Most Likely $200,000');
    expect(md).toContain('Hedge $50,000');
  });

  it('counts churn-notice events in the talk-track', () => {
    const acc = mkAccount({ accountId: 'A5' });
    const view = mkView(acc, [mkOpportunity({ accountId: 'A5' })]);
    const event: ChangeEvent = {
      accountId: 'A5',
      opportunityId: 'O5',
      field: 'fullChurnNotificationToOwnerDate',
      oldValue: null,
      newValue: '2026-04-25',
      occurredBetween: ['prev', 'curr'],
      category: 'churn-notice',
      label: 'Renewal: Churn notice submitted',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [event],
      asOfDate: '2026-04-28',
    });
    expect(md).toContain('New churn notices submitted: 1.');
  });

  it('emits "None." for empty buckets so the section never silently disappears', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: '2026-04-28',
    });
    // All four account-list sections should explicitly note absence.
    const noneCount = (md.match(/^- None\.$/gm) ?? []).length;
    expect(noneCount).toBeGreaterThanOrEqual(4);
  });
});
