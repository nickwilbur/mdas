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
import { generateWeeklyForecast } from './index';

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
    forecastCategory: 'Commit',
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
      'Accounts with Hedge (churn-save renewals):',
      'Churn-save targets not yet hedged in Clari (ATR exposed):',
      'Accounts to Close Gap (churn-save renewals):',
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
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: -\$250,000/);
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
    expect(md).toMatch(/Total Churn\/Downsell Risk \/ Baseline: -\$500,000/);
  });

  it('computes Gap to Plan when plan is provided', () => {
    const acc = mkAccount();
    const opp = mkOpportunity({ knownChurnUSD: 100_000, closeDate: '2026-04-15' });
    const view = mkView(acc, [opp], { bucket: 'Confirmed Churn' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: AS_OF,
      plan: { currentQuarterUSD: -250_000 },
    });
    // Flash -$100k vs Plan -$250k → +$150k (less churn loss than plan)
    expect(md).toMatch(/Gap to Plan: \+\$150,000/);
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

  it('does not paste scoring-fallback rationales into Key Saves bullets', () => {
    // Reproduces the FY27 Q2 output where green-band rows trailed
    // "No Cerebro Risk Category and no fallback signals available".
    // The bullet must show only "name ($amount)" when the only
    // available rationale is a fallback string.
    const greenAcc = mkAccount({
      accountId: 'GREEN-NO-DATA',
      accountName: 'EverCommerce',
      cerebroRiskCategory: null,
      cerebroRisks: {
        utilizationRisk: null,
        engagementRisk: null,
        suiteRisk: null,
        shareRisk: null,
        legacyTechRisk: null,
        expertiseRisk: null,
        pricingRisk: null,
      },
      cseSentiment: 'Green',
    });
    const greenOpp = mkOpportunity({
      accountId: 'GREEN-NO-DATA',
      acv: 100_000,
      closeDate: '2026-06-01',
      scNextSteps: null,
      flmNotes: null,
      slmNotes: null,
    });
    const yellowAcc = mkAccount({
      accountId: 'YELLOW-NO-DATA',
      accountName: 'Tobii Dynavox',
      cerebroRiskCategory: null,
      cseSentiment: 'Yellow',
    });
    const yellowOpp = mkOpportunity({
      accountId: 'YELLOW-NO-DATA',
      acv: 55_800,
      closeDate: '2026-06-01',
      scNextSteps: null,
      flmNotes: null,
      slmNotes: null,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(greenAcc, [greenOpp]),
        mkView(yellowAcc, [yellowOpp], {
          bucket: 'Saveable Risk',
          risk: {
            level: 'Medium',
            source: 'fallback',
            rationale: 'CSE Sentiment Yellow; no Cerebro data',
          },
        }),
      ],
      changeEvents: [],
      asOfDate: '2026-05-01', // FY27 Q2
    });
    expect(md).not.toContain('no Cerebro data');
    expect(md).not.toContain('No Cerebro Risk Category');
    expect(md).not.toContain('of 7 Cerebro risks');
    expect(md).toMatch(/- EverCommerce \(\$100,000\)\n/);
    expect(md).toMatch(/- Tobii Dynavox \(\$55,800\)\n/);
  });

  it('prefers SE_Next_Steps, then FLM/SLM notes, then sentiment commentary for Key Saves detail', () => {
    const a1 = mkAccount({ accountId: 'A1', accountName: 'NextSteps Co' });
    const o1 = mkOpportunity({
      accountId: 'A1',
      acv: 100_000,
      closeDate: '2026-06-01',
      scNextSteps: 'Schedule QBR with new VP Finance',
      flmNotes: 'ignored when scNextSteps present',
    });
    const a2 = mkAccount({
      accountId: 'A2',
      accountName: 'Sentiment Co',
      cseSentimentCommentary: 'Renewal at risk: legal review blocking PO',
    });
    const o2 = mkOpportunity({
      accountId: 'A2',
      acv: 80_000,
      closeDate: '2026-06-01',
      scNextSteps: null,
      flmNotes: null,
      slmNotes: null,
    });
    const md = generateWeeklyForecast({
      views: [mkView(a1, [o1]), mkView(a2, [o2])],
      changeEvents: [],
      asOfDate: '2026-05-01',
    });
    expect(md).toContain('NextSteps Co ($100,000) - Schedule QBR with new VP Finance');
    expect(md).toContain('Sentiment Co ($80,000) - Renewal at risk: legal review blocking PO');
  });

  it('shows + for risk improvement and - for risk regression in WoW', () => {
    const acc = mkAccount({ accountId: 'A2', accountName: 'Better Co' });
    const view = mkView(
      acc,
      [
        mkOpportunity({
          accountId: 'A2',
          closeDate: '2026-04-15',
          forecastMostLikely: -50_000,
          acvDelta: -50_000,
        }),
      ],
      { bucket: 'Saveable Risk' },
    );
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
    expect(md).toMatch(/\+ Better Co - ↑ Risk High → Low/);
  });

  it('flags churn-notice events as regressions (-)', () => {
    const acc = mkAccount({ accountId: 'A3', accountName: 'New Churn Co' });
    const view = mkView(
      acc,
      [
        mkOpportunity({
          opportunityId: 'O-A3',
          accountId: 'A3',
          closeDate: '2026-04-15',
          knownChurnUSD: 100_000,
        }),
      ],
      { bucket: 'Confirmed Churn' },
    );
    const churnEvent: ChangeEvent = {
      accountId: 'A3',
      opportunityId: 'O-A3',
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
    expect(md).toMatch(/- New Churn Co - ↓ Churn notice submitted/);
  });

  // 2026-05-20 fourth-pass: opportunity-level diffs (stage moves,
  // forecast ML, close-date slips) were silently dropped by the old
  // wowChanges() which only knew about cerebroRiskCategory /
  // cseSentiment / churn-notice. Leadership lost visibility into the
  // most actionable WoW signals. Pin the new forecast-relevant signal
  // set with the live D&B / DataStax / Turf Tank scenarios.
  it('surfaces stage moves to Closed Won (DataStax-like)', () => {
    const acc = mkAccount({ accountId: 'DS', accountName: 'DataStax' });
    const renewal = mkOpportunity({
      opportunityId: 'O-DS',
      accountId: 'DS',
      closeDate: '2026-04-15',
      forecastMostLikely: -209_259,
      acvDelta: -209_259,
    });
    const view = mkView(acc, [renewal], { bucket: 'Saveable Risk' });
    const stageMove: ChangeEvent = {
      accountId: 'DS',
      opportunityId: 'O-DS',
      field: 'stageName',
      oldValue: '7.0 - Closed/Won (Sales)',
      newValue: '8.0 - Closed/Won (Finance)',
      occurredBetween: ['p', 'c'],
      category: 'forecast',
      label: 'Stage moved',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [stageMove],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/\+ DataStax - ↑ Stage 7\.0 - Closed\/Won \(Sales\) → 8\.0 - Closed\/Won \(Finance\)/);
  });

  it('surfaces forecast ML changes >= $25K (D&B-like)', () => {
    const acc = mkAccount({ accountId: 'DB', accountName: 'D&B' });
    const renewal = mkOpportunity({
      opportunityId: 'O-DB',
      accountId: 'DB',
      closeDate: '2026-04-15',
      forecastMostLikely: -749_973,
      acvDelta: -749_973,
    });
    const view = mkView(acc, [renewal], { bucket: 'Saveable Risk' });
    const events: ChangeEvent[] = [
      {
        accountId: 'DB',
        opportunityId: 'O-DB',
        field: 'stageName',
        oldValue: '3.0 Define',
        newValue: '5.0 Propose',
        occurredBetween: ['p', 'c'],
        category: 'forecast',
        label: 'Stage moved',
      },
      {
        accountId: 'DB',
        opportunityId: 'O-DB',
        field: 'forecastMostLikely',
        oldValue: -850_000,
        newValue: -749_973,
        occurredBetween: ['p', 'c'],
        category: 'forecast',
        label: 'ML changed',
      },
    ];
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: events,
      asOfDate: AS_OF,
    });
    // Both signals aggregated on the same line. Sign is "+" because
    // both events are improvements (stage forward jump, ML less
    // negative).
    expect(md).toMatch(/\+ D&B - ↑ Stage 3\.0 Define → 5\.0 Propose; ↑ Forecast ML -\$850,000 → -\$749,973 \(\+\$100,027\)/);
  });

  it('aggregates regression + improvement on same account; sign is - (Turf Tank-like)', () => {
    const acc = mkAccount({ accountId: 'TT', accountName: 'Turf Tank Aggregate' });
    const renewal = mkOpportunity({
      opportunityId: 'O-TT-1',
      accountId: 'TT',
      closeDate: '2026-04-15',
      forecastMostLikely: -82_327,
      acvDelta: -82_327,
    });
    const view = mkView(acc, [renewal], { bucket: 'Saveable Risk' });
    const events: ChangeEvent[] = [
      {
        accountId: 'TT',
        opportunityId: 'O-TT-1',
        field: 'forecastMostLikely',
        oldValue: -43_000,
        newValue: -82_327,
        occurredBetween: ['p', 'c'],
        category: 'forecast',
        label: 'ML changed',
      },
      {
        accountId: 'TT',
        field: 'cseSentiment',
        oldValue: 'Yellow',
        newValue: 'Green',
        occurredBetween: ['p', 'c'],
        category: 'sentiment',
        label: 'Sentiment improved',
      },
    ];
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: events,
      asOfDate: AS_OF,
    });
    // Account-level sign is "-" because at least one event is a
    // regression (ML went more negative).
    expect(md).toMatch(/- Turf Tank Aggregate - ↓ Forecast ML -\$43,000 → -\$82,327 \(-\$39,327\); ↑ Sentiment Yellow → Green/);
  });

  // 2026-05-20 fifth-pass: WoW scope = same churn-save lens as the
  // Hedge / Close-Gap sections. Accounts whose only opps are
  // expansions / new business / healthy renewals must not appear
  // even when their opp-level fields move.
  it('suppresses WoW changes on accounts with no churn-save renewal (expansion-only)', () => {
    const acc = mkAccount({ accountId: 'EX', accountName: 'Expansion Only Co' });
    const expansion = mkOpportunity({
      opportunityId: 'O-EX',
      accountId: 'EX',
      closeDate: '2026-04-15',
      type: 'Amendment',
      forecastMostLikely: 100_000,
      acvDelta: 50_000,
    });
    const view = mkView(acc, [expansion], { bucket: 'Healthy' });
    const stageMove: ChangeEvent = {
      accountId: 'EX',
      opportunityId: 'O-EX',
      field: 'stageName',
      oldValue: '3.0 Define',
      newValue: '8.0 - Closed/Won (Finance)',
      occurredBetween: ['p', 'c'],
      category: 'forecast',
      label: 'Stage moved',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [stageMove],
      asOfDate: AS_OF,
    });
    const wow = md.slice(md.indexOf('Week-over-week'));
    expect(wow).toMatch(/No movement this week/);
  });

  it('suppresses expansion-opp diffs on accounts that DO have a churn-save renewal', () => {
    // Account is a valid churn-save target (renewal at ML -$50K) but
    // the WoW event fires on its expansion Amendment opp. The opp-
    // level diff should be dropped; only renewal-opp diffs and
    // account-level signals count.
    const acc = mkAccount({ accountId: 'MX', accountName: 'Mixed Co' });
    const renewal = mkOpportunity({
      opportunityId: 'O-MX-RENEW',
      accountId: 'MX',
      closeDate: '2026-04-15',
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
    });
    const expansion = mkOpportunity({
      opportunityId: 'O-MX-EXP',
      accountId: 'MX',
      closeDate: '2026-04-20',
      type: 'Amendment',
      forecastMostLikely: 100_000,
      acvDelta: 50_000,
    });
    const view = mkView(acc, [renewal, expansion], { bucket: 'Saveable Risk' });
    const expansionStageMove: ChangeEvent = {
      accountId: 'MX',
      opportunityId: 'O-MX-EXP',
      field: 'stageName',
      oldValue: '3.0 Define',
      newValue: '8.0 - Closed/Won (Finance)',
      occurredBetween: ['p', 'c'],
      category: 'forecast',
      label: 'Stage moved',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [expansionStageMove],
      asOfDate: AS_OF,
    });
    const wow = md.slice(md.indexOf('Week-over-week'));
    expect(wow).toMatch(/No movement this week/);
  });

  it('suppresses forecast ML changes below the $25K threshold', () => {
    const acc = mkAccount({ accountId: 'TT', accountName: 'Tiny Move' });
    const renewal = mkOpportunity({
      opportunityId: 'O-TM',
      accountId: 'TT',
      closeDate: '2026-04-15',
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
    });
    const view = mkView(acc, [renewal], { bucket: 'Saveable Risk' });
    const tinyMove: ChangeEvent = {
      accountId: 'TT',
      opportunityId: 'O-TM',
      field: 'forecastMostLikely',
      oldValue: -50_000,
      newValue: -55_000,
      occurredBetween: ['p', 'c'],
      category: 'forecast',
      label: 'ML moved',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [tinyMove],
      asOfDate: AS_OF,
    });
    const wow = md.slice(md.indexOf('Week-over-week'));
    expect(wow).toMatch(/No movement this week/);
  });

  it('suppresses stage moves that are not Closed-* and not a >=2 numeric jump', () => {
    const acc = mkAccount({ accountId: 'NM', accountName: 'No Move Co' });
    const renewal = mkOpportunity({
      opportunityId: 'O-NM',
      accountId: 'NM',
      closeDate: '2026-04-15',
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
    });
    const view = mkView(acc, [renewal], { bucket: 'Saveable Risk' });
    const oneStepMove: ChangeEvent = {
      accountId: 'NM',
      opportunityId: 'O-NM',
      field: 'stageName',
      oldValue: '4.0 Validate',
      newValue: '5.0 Propose',
      occurredBetween: ['p', 'c'],
      category: 'forecast',
      label: 'Stage advanced',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [oneStepMove],
      asOfDate: AS_OF,
    });
    const wow = md.slice(md.indexOf('Week-over-week'));
    expect(wow).toMatch(/No movement this week/);
  });

  it('suppresses close-date slips of less than 7 days', () => {
    const acc = mkAccount({ accountId: 'SD', accountName: 'Small Slip' });
    const renewal = mkOpportunity({
      opportunityId: 'O-SS',
      accountId: 'SD',
      closeDate: '2026-04-15',
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
    });
    const view = mkView(acc, [renewal], { bucket: 'Saveable Risk' });
    const slip: ChangeEvent = {
      accountId: 'SD',
      opportunityId: 'O-SS',
      field: 'closeDate',
      oldValue: '2026-04-10',
      newValue: '2026-04-13',
      occurredBetween: ['p', 'c'],
      category: 'forecast',
      label: 'Close slipped',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [slip],
      asOfDate: AS_OF,
    });
    const wow = md.slice(md.indexOf('Week-over-week'));
    expect(wow).toMatch(/No movement this week/);
  });

  it('surfaces close-date slips >= 7 days as regressions', () => {
    const acc = mkAccount({ accountId: 'BS', accountName: 'Big Slip' });
    const renewal = mkOpportunity({
      opportunityId: 'O-BS',
      accountId: 'BS',
      closeDate: '2026-04-15',
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
    });
    const view = mkView(acc, [renewal], { bucket: 'Saveable Risk' });
    const slip: ChangeEvent = {
      accountId: 'BS',
      opportunityId: 'O-BS',
      field: 'closeDate',
      oldValue: '2026-04-01',
      newValue: '2026-04-30',
      occurredBetween: ['p', 'c'],
      category: 'forecast',
      label: 'Close slipped',
    };
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [slip],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/- Big Slip - ↓ Close 2026-04-01 → 2026-04-30 \(\+29d\)/);
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

  it('does not treat ATR minus positive Most Likely as churn on renewals (avoids Flash inflation vs Clari)', () => {
    const acc = mkAccount({ accountName: 'Big ATR Co' });
    const opp = mkOpportunity({
      type: 'Renewal',
      availableToRenewUSD: 3_000_000,
      forecastMostLikely: 2_500_000,
      acvDelta: 0,
      knownChurnUSD: 0,
      closeDate: '2026-06-10',
    });
    const view = mkView(acc, [opp], { bucket: 'Saveable Risk' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-05-13',
    });
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: \$0/);
  });

  it('counts renewal Flash from negative ACV delta when Most Likely is not negative', () => {
    const acc = mkAccount({ accountName: 'Delta Down Co' });
    const opp = mkOpportunity({
      type: 'Renewal',
      availableToRenewUSD: 400_000,
      forecastMostLikely: 350_000,
      acvDelta: -42_000,
      knownChurnUSD: 0,
      closeDate: '2026-06-10',
    });
    const view = mkView(acc, [opp], { bucket: 'Saveable Risk' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-05-13',
    });
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: -\$42,000/);
  });

  it('ignores non-renewal opps for ML / ACV delta Flash (upsell path)', () => {
    const acc = mkAccount({ accountName: 'Upsell Co' });
    const opp = mkOpportunity({
      type: 'New Business',
      availableToRenewUSD: 1_000_000,
      forecastMostLikely: -99_000,
      acvDelta: -99_000,
      closeDate: '2026-06-10',
    });
    const view = mkView(acc, [opp], { bucket: 'Saveable Risk' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-05-13',
    });
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: \$0/);
  });

  it('treats negative Forecast Most Likely as churn dollars (not ATR − ML inflation)', () => {
    const acc = mkAccount({ accountId: 'DNB', accountName: 'D&B' });
    const opp = mkOpportunity({
      accountId: 'DNB',
      closeDate: '2026-05-27',
      availableToRenewUSD: 1_124_973,
      forecastMostLikely: -800_000,
      knownChurnUSD: 0,
    });
    const view = mkView(acc, [opp], { bucket: 'Saveable Risk' });
    const md = generateWeeklyForecast({
      views: [view],
      changeEvents: [],
      asOfDate: '2026-05-13',
    });
    expect(md).toMatch(/Churn\/Downsell Flash \/ Most Likely: -\$800,000/);
    expect(md).not.toMatch(/Churn\/Downsell Flash \/ Most Likely: \$1,924,973/);
  });

  it('buckets August close dates into next fiscal quarter, not current, when current is FY27 Q2', () => {
    const accQ2 = mkAccount({ accountId: 'C2', accountName: 'June Co' });
    const oppQ2 = mkOpportunity({
      accountId: 'C2',
      knownChurnUSD: 100_000,
      closeDate: '2026-06-15',
    });
    const accQ3 = mkAccount({ accountId: 'C3', accountName: 'August Co' });
    const oppQ3 = mkOpportunity({
      accountId: 'C3',
      knownChurnUSD: 777_000,
      closeDate: '2026-08-15',
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(accQ2, [oppQ2], { bucket: 'Confirmed Churn' }),
        mkView(accQ3, [oppQ3], { bucket: 'Confirmed Churn' }),
      ],
      changeEvents: [],
      asOfDate: '2026-05-01',
    });
    const currIdx = md.indexOf('Current Quarter');
    const nextIdx = md.indexOf('Next Quarter');
    const currSection = md.slice(currIdx, nextIdx);
    const nextSection = md.slice(nextIdx);
    expect(currSection).toMatch(/Flash \/ Most Likely: -\$100,000/);
    expect(currSection).not.toContain('777');
    expect(nextSection).toMatch(/August Co/);
    expect(nextSection).toMatch(/Flash \/ Most Likely: -\$777,000/);
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
    expect(currSection).toMatch(/Flash \/ Most Likely: -\$100,000/);
    expect(nextSection).toMatch(/Flash \/ Most Likely: -\$200,000/);
  });

  // 2026-05-20 manager feedback: Hedge / Close-Gap sections must only
  // surface churn-save opps, not expansion hedge. Pins the new
  // isChurnSaveTarget filter end-to-end.
  it('excludes expansion-opp hedge from the Hedge section (renewal-only)', () => {
    const acc = mkAccount({ accountId: 'PD', accountName: 'Pipedrive' });
    const expansionOpp = mkOpportunity({
      opportunityId: 'O-EXP',
      opportunityName: 'Pipedrive Expansion',
      accountId: 'PD',
      type: 'New Business - Expansion',
      forecastHedgeUSD: 75_000,
      forecastCategory: 'Best Case',
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [expansionOpp], { bucket: 'Healthy' })],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const currSection = md.slice(0, md.indexOf('Next Quarter'));
    const hedgeBlock = currSection.slice(
      currSection.indexOf('Accounts with Hedge'),
      currSection.indexOf('Key Saves'),
    );
    expect(hedgeBlock).not.toContain('Pipedrive');
    expect(hedgeBlock).toMatch(/Accounts with Hedge \(churn-save renewals\): \$0/);
  });

  it('excludes Omit-category renewals from Hedge / Close-Gap (already conceded)', () => {
    const acc = mkAccount({
      accountId: 'OM',
      accountName: 'Omitted Co',
      cseSentiment: 'Red',
    });
    const omittedRenewal = mkOpportunity({
      accountId: 'OM',
      type: 'Renewal',
      forecastHedgeUSD: 50_000,
      forecastCategory: 'Omit',
      availableToRenewUSD: 300_000,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [omittedRenewal], {
          bucket: 'Confirmed Churn',
          risk: { level: 'Critical', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    // Account should not appear in the Hedge or Close-Gap totals/rows.
    const currSection = md.slice(0, md.indexOf('Next Quarter'));
    const hedgeBlock = currSection.slice(
      currSection.indexOf('Accounts with Hedge'),
      currSection.indexOf('Accounts to Close Gap'),
    );
    expect(hedgeBlock).not.toContain('Omitted Co');
    const gapBlock = currSection.slice(
      currSection.indexOf('Accounts to Close Gap'),
      currSection.indexOf('Key Saves'),
    );
    expect(gapBlock).not.toContain('Omitted Co');
  });

  // 2026-05-20 follow-up: Pipedrive's two Upside renewals were
  // appearing on the Hedge list even though the manager doesn't carry
  // them in Clari. Snapshot data: forecastCategory 'Upside', $25K
  // hedge, ML +$25K (or 0), ACV delta 0 — i.e., the rep is hedging
  // *pure upside* (no down-forecast on the renewal). The third-pass
  // filter excludes this case via the no-down-forecast-signal rule:
  // negative ML / negative ACV delta / known churn is required.
  // (We deliberately do NOT exclude the Upside category itself —
  // see the Finale and Kustomer tests above.)
  it('excludes Healthy Upside renewals with hedge but no down-forecast (the Pipedrive bug)', () => {
    const acc = mkAccount({
      accountId: 'PD',
      accountName: 'Pipedrive, Inc.',
      cseSentiment: 'Yellow',
    });
    const upsideRenewal = mkOpportunity({
      accountId: 'PD',
      type: 'Renewal',
      forecastHedgeUSD: 25_000,
      forecastCategory: 'Upside',
      forecastMostLikely: 25_000,
      acvDelta: 0,
      knownChurnUSD: 0,
      availableToRenewUSD: 711_610,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [upsideRenewal], {
          bucket: 'Healthy',
          risk: { level: 'Medium', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const currSection = md.slice(0, md.indexOf('Next Quarter'));
    const hedgeBlock = currSection.slice(
      currSection.indexOf('Accounts with Hedge'),
      currSection.indexOf('Key Saves'),
    );
    expect(hedgeBlock).not.toContain('Pipedrive');
    expect(hedgeBlock).toMatch(/Accounts with Hedge \(churn-save renewals\): \$0/);
  });

  // 2026-05-20 third-pass: the Upside category is not a reliable
  // "expansion only" signal — Finale / Zello / Kustomer all sit in
  // Upside-family categories AND show negative ML/ACV delta because
  // the rep is forecasting a net downsell while also hedging some
  // upside dollars. Pins that an Upside renewal with a down-forecast
  // signal IS included (this was excluded by the over-aggressive
  // 2026-05-20 second-pass fix).
  it('includes Saveable Risk Upside renewal when ML is negative (Finale-like)', () => {
    const acc = mkAccount({
      accountId: 'FI',
      accountName: 'Finale Inventory',
      cseSentiment: 'Red',
    });
    const renewal = mkOpportunity({
      accountId: 'FI',
      type: 'Renewal',
      forecastCategory: 'Committed Upside',
      forecastHedgeUSD: 50_000,
      forecastMostLikely: -75_000,
      acvDelta: -38_900,
      availableToRenewUSD: 102_500,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [renewal], {
          bucket: 'Saveable Risk',
          risk: { level: 'High', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const currSection = md.slice(0, md.indexOf('Next Quarter'));
    const hedgeBlock = currSection.slice(
      currSection.indexOf('Accounts with Hedge'),
      currSection.indexOf('Key Saves'),
    );
    expect(hedgeBlock).toContain('Finale Inventory');
    expect(hedgeBlock).toMatch(/Accounts with Hedge \(churn-save renewals\): \$50,000/);
  });

  // 2026-05-20 third-pass: Healthy-bucket accounts can also be on the
  // manager's Clari hedge list when their renewal has a down forecast.
  // Kustomer is the verified example — Healthy/Yellow, Targeted Upside
  // renewal at ML -$20K. Pins that account bucket is NOT a gate.
  it('includes Healthy renewal with down-forecast on Upside category (Kustomer-like)', () => {
    const acc = mkAccount({
      accountId: 'KU',
      accountName: 'Kustomer, LLC.',
      cseSentiment: 'Yellow',
    });
    const renewal = mkOpportunity({
      accountId: 'KU',
      type: 'Renewal',
      forecastCategory: 'Targeted Upside',
      forecastHedgeUSD: 15_000,
      forecastMostLikely: -20_000,
      acvDelta: -15_000,
      availableToRenewUSD: 143_845,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [renewal], {
          bucket: 'Healthy',
          risk: { level: 'Medium', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const currSection = md.slice(0, md.indexOf('Next Quarter'));
    const hedgeBlock = currSection.slice(
      currSection.indexOf('Accounts with Hedge'),
      currSection.indexOf('Key Saves'),
    );
    expect(hedgeBlock).toContain('Kustomer, LLC.');
  });

  it('excludes renewals with null forecastCategory (not yet on manager forecast line)', () => {
    const acc = mkAccount({ accountId: 'X', accountName: 'No Category Co' });
    const renewalNoCategory = mkOpportunity({
      accountId: 'X',
      type: 'Renewal',
      forecastHedgeUSD: 40_000,
      forecastCategory: null,
      forecastMostLikely: -30_000,
      acvDelta: -30_000,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [renewalNoCategory], {
          bucket: 'Saveable Risk',
          risk: { level: 'High', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const currSection = md.slice(0, md.indexOf('Next Quarter'));
    const hedgeBlock = currSection.slice(
      currSection.indexOf('Accounts with Hedge'),
      currSection.indexOf('Key Saves'),
    );
    expect(hedgeBlock).not.toContain('No Category Co');
  });

  it('flags churn-save targets not yet hedged in Clari as an explicit call-out', () => {
    const acc = mkAccount({
      accountId: 'TG',
      accountName: 'Target Without Hedge',
      cseSentiment: 'Red',
    });
    const renewalNoHedge = mkOpportunity({
      accountId: 'TG',
      type: 'Renewal',
      forecastHedgeUSD: 0,
      forecastCategory: 'Best Case',
      availableToRenewUSD: 420_000,
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [renewalNoHedge], {
          bucket: 'Saveable Risk',
          risk: { level: 'High', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const callout = md.match(
      /Churn-save targets not yet hedged in Clari \(ATR exposed\):[\s\S]*?(?=\nAccounts to Close Gap)/,
    );
    expect(callout, 'expected churn-save-targets call-out to appear').toBeTruthy();
    expect(callout![0]).toContain('Target Without Hedge');
    expect(callout![0]).toContain('$420,000 ATR');
  });
});
