// Tests for the churn-call forecast generator.
//
// The output is a plaintext script the CSE manager pastes into their
// quarterly churn-call doc. These tests pin:
//   1. Section ordering (Current Quarter then Next Quarter, with the
//      template fields in the documented order).
//   2. Plaintext-only invariants (no markdown links, no bold).
//   3. Color band semantics (red / yellow / green).
//   4. Plan / Flash / Gap / Total Risk / Hedge math.
//   5. WoW +/- sign (improvement vs regression).
import { describe, expect, it } from 'vitest';
import type {
  AccountView,
  CanonicalAccount,
  CanonicalOpportunity,
  ChangeEvent,
} from '@mdas/canonical';
import { generateWeeklyForecast } from './index.js';

const REFRESH_AT = '2026-04-28T18:00:00.000Z';
const AS_OF = '2026-04-28'; // FY27 Q1 (Feb 2026 → Apr 2026)

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
    closeDate: '2026-04-15', // FY27 Q1 by default
    closeQuarter: 'Q1',
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

describe('generateWeeklyForecast (churn-call script)', () => {
  it('renders Current Quarter then Next Quarter with all template fields', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const expectedFields = [
      'Current Quarter:',
      'Churn/Downsell Plan:',
      'Churn/Downsell Flash / Most Likely:',
      'Gap to Plan:',
      'Total Churn/Downsell Risk / Baseline:',
      'Hedge:',
      'Accounts to Close Gap:',
      'Key Saves/Improvements to close the gap from Total Churn/Downsell risk to Flash:',
      'Accounts in yellow - path to add hedge to the line:',
      'Accounts in green - path to capture the existing hedge already in the line:',
      'Week-over-week Changes - Improvements and increased risk:',
      'Next Quarter:',
    ];
    let cursor = 0;
    for (const field of expectedFields) {
      const idx = md.indexOf(field, cursor);
      expect(idx, `expected ${field} after position ${cursor}`).toBeGreaterThan(
        -1,
      );
      cursor = idx + field.length;
    }
  });

  it('emits plaintext only — no markdown links or bold', () => {
    const acc = mkAccount({
      accountId: 'A1',
      accountName: 'Stenograph LLC',
      sourceLinks: [
        { label: 'Salesforce', url: 'https://sf.example/A1', source: 'salesforce' },
      ],
      cseSentiment: 'Confirmed Churn',
      isConfirmedChurn: true,
    });
    const opp = mkOpportunity({
      accountId: 'A1',
      knownChurnUSD: 250_000,
      sourceLinks: [
        { label: 'Renewal opp', url: 'https://sf.example/O1', source: 'salesforce' },
      ],
    });
    const view = mkView(acc, [opp], { bucket: 'Confirmed Churn' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).not.toMatch(/\[.+\]\(http/); // markdown link [label](url)
    expect(md).not.toContain('**'); // markdown bold
    expect(md).toContain('Stenograph LLC');
  });

  it('labels the current quarter using fiscal-quarter math', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: '2026-04-28', // FY27 Q1
    });
    expect(md).toContain('Current Quarter: FY27 Q1');
    expect(md).toContain('Next Quarter: FY27 Q2');
  });

  it('rolls year boundary — Jan asOfDate sits in Q4 of prior FY', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: '2027-01-10', // FY27 Q4
    });
    expect(md).toContain('Current Quarter: FY27 Q4');
    expect(md).toContain('Next Quarter: FY28 Q1');
  });

  it('computes Flash from knownChurnUSD when provided', () => {
    const acc = mkAccount({ accountName: 'Stenograph LLC', isConfirmedChurn: true });
    const opp = mkOpportunity({ knownChurnUSD: 250_000, closeDate: '2026-04-15' });
    const view = mkView(acc, [opp], { bucket: 'Confirmed Churn' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: \$250,000/);
  });

  it('computes Total Risk from ATR for saveable accounts', () => {
    const acc = mkAccount({ accountName: 'Acme Corp' });
    const opp = mkOpportunity({
      availableToRenewUSD: 500_000,
      forecastMostLikely: 500_000, // no churn baked in
      closeDate: '2026-04-15',
    });
    const view = mkView(acc, [opp], {
      bucket: 'Saveable Risk',
      risk: { level: 'High', source: 'cerebro', rationale: '' },
    });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/Total Churn\/Downsell Risk \/ Baseline: \$500,000/);
  });

  it('computes Gap to Plan when plan is provided', () => {
    const acc = mkAccount();
    const opp = mkOpportunity({ knownChurnUSD: 100_000, closeDate: '2026-04-15' });
    const view = mkView(acc, [opp], { bucket: 'Confirmed Churn' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: AS_OF,
      plan: { currentQuarterUSD: 250_000 },
    });
    // Flash $100k vs Plan $250k → -$150k (under plan = good)
    expect(md).toMatch(/Gap to Plan: -\$150,000/);
  });

  it('emits [fill in] placeholders when Plan is not provided', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toContain('Churn/Downsell Plan: [fill in]');
    expect(md).toContain('Gap to Plan: [fill in once Plan is set]');
  });

  it('classifies accounts into red / yellow / green by risk + sentiment', () => {
    const red = mkView(
      mkAccount({ accountId: 'R', accountName: 'Red Co', cseSentiment: 'Red' }),
      [mkOpportunity({ accountId: 'R', availableToRenewUSD: 200_000, forecastMostLikely: 0, closeDate: '2026-04-15' })],
      {
        bucket: 'Saveable Risk',
        risk: { level: 'Critical', source: 'cerebro', rationale: '' },
      },
    );
    const yellow = mkView(
      mkAccount({ accountId: 'Y', accountName: 'Yellow Co', cseSentiment: 'Yellow' }),
      [mkOpportunity({ accountId: 'Y', availableToRenewUSD: 100_000, forecastMostLikely: 50_000, closeDate: '2026-04-15' })],
      {
        bucket: 'Saveable Risk',
        risk: { level: 'Medium', source: 'cerebro', rationale: '' },
      },
    );
    const green = mkView(
      mkAccount({ accountId: 'G', accountName: 'Green Co' }),
      [mkOpportunity({ accountId: 'G', forecastHedgeUSD: 75_000, closeDate: '2026-04-15' })],
    );
    const md = generateWeeklyForecast({
      views: [red, yellow, green],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    // Red Co should appear under "Accounts in red - risk trending"
    const redIdx = md.indexOf('Accounts in red - risk trending');
    const yellowIdx = md.indexOf('Accounts in yellow - path to add hedge');
    const greenIdx = md.indexOf('Accounts in green - path to capture');
    expect(md.slice(redIdx, yellowIdx)).toContain('Red Co');
    expect(md.slice(yellowIdx, greenIdx)).toContain('Yellow Co');
    expect(md.slice(greenIdx)).toContain('Green Co');
  });

  it('shows + for risk improvement and - for risk regression in WoW', () => {
    const acc = mkAccount({ accountId: 'A2', accountName: 'Better Co' });
    const view = mkView(acc, [mkOpportunity({ accountId: 'A2', closeDate: '2026-04-15' })], {
      bucket: 'Saveable Risk',
    });
    const improved: ChangeEvent = {
      accountId: 'A2',
      field: 'cerebroRiskCategory',
      oldValue: 'High',
      newValue: 'Low',
      occurredBetween: ['p', 'c'],
      category: 'risk',
      label: 'Risk High → Low',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [improved],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/\+ Better Co - Risk High → Low/);
  });

  it('flags churn-notice events as regressions (-)', () => {
    const acc = mkAccount({ accountId: 'A3', accountName: 'New Churn Co' });
    const view = mkView(acc, [mkOpportunity({ accountId: 'A3', closeDate: '2026-04-15' })]);
    const churnEvent: ChangeEvent = {
      accountId: 'A3',
      opportunityId: 'O3',
      field: 'fullChurnNotificationToOwnerDate',
      oldValue: null,
      newValue: '2026-04-25',
      occurredBetween: ['p', 'c'],
      category: 'churn-notice',
      label: 'Churn notice',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [churnEvent],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/- New Churn Co - Churn notice submitted/);
  });

  it('omits hygiene call-outs entirely (leadership lens)', () => {
    const md = generateWeeklyForecast({
      views: [],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).not.toContain('Hygiene');
    expect(md).not.toContain('hygiene');
  });

  it('partitions opportunities into the correct quarter by closeDate', () => {
    const accCurrent = mkAccount({ accountId: 'AC', accountName: 'Current Co' });
    const oppCurrent = mkOpportunity({
      accountId: 'AC',
      knownChurnUSD: 100_000,
      closeDate: '2026-04-15', // FY27 Q1
    });
    const accNext = mkAccount({ accountId: 'AN', accountName: 'Next Co' });
    const oppNext = mkOpportunity({
      accountId: 'AN',
      knownChurnUSD: 200_000,
      closeDate: '2026-06-15', // FY27 Q2
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(accCurrent, [oppCurrent], { bucket: 'Confirmed Churn' }),
        mkView(accNext, [oppNext], { bucket: 'Confirmed Churn' }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const currIdx = md.indexOf('Current Quarter');
    const nextIdx = md.indexOf('Next Quarter');
    const currSection = md.slice(currIdx, nextIdx);
    const nextSection = md.slice(nextIdx);
    expect(currSection).toMatch(/Flash \/ Most Likely: \$100,000/);
    expect(nextSection).toMatch(/Flash \/ Most Likely: \$200,000/);
  });
});
