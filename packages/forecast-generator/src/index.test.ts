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
import {
  computeQuarterKpis,
  fiscalQuarterFromDate,
  fiscalQuarterStart,
  generateWeeklyForecast,
} from './index';

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
      'Week-over-week Changes - Improvements and increased risk:',
      'Key Saves/Improvements to close the gap from Total Churn/Downsell risk to Flash:',
      'Accounts in yellow - path to add hedge to the line:',
      'Accounts in green - path to capture the existing hedge already in the line:',
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
    // Fallback / scoring-derived rationales never appear in Key Saves
    // bullets — the bullets now compose deterministic chip lines from
    // Cerebro Risk Category, CSE Sentiment, Renewal date, and Forecast
    // ML, plus a one-sentence SC Next Steps when present. The bullets
    // here still render (chip line for sentiment / renewal date), but
    // never with the synthetic rationale text from `view.risk`.
    expect(md).not.toContain('no Cerebro data');
    expect(md).not.toContain('No Cerebro Risk Category');
    expect(md).not.toContain('of 7 Cerebro risks');
    // Bullets still render with the (sparse) chip line — no SC Next
    // Steps means no prose tail, but the chip line carries Sentiment
    // and Renewal date for the exec scan.
    expect(md).toMatch(/- EverCommerce \(\$100,000\) - .*Sentiment: Green.*Renewal: 2026-06-01/);
    expect(md).toMatch(/- Tobii Dynavox \(\$55,800\) - .*Sentiment: Yellow.*Renewal: 2026-06-01/);
  });

  it('uses SC Next Steps as the only Key Saves prose source; ignores FLM/SLM notes and CSE sentiment commentary', () => {
    // Per 2026-05-20 manager feedback: Key Saves bullets read as
    // unreadable rich-text dumps when we fell back to FLM/SLM notes or
    // CSE sentiment commentary (often multi-paragraph "STATE AND
    // RENEWAL RISK:" narratives the exec couldn't scan on a call). The
    // new contract is: deterministic chip line + one sentence from SC
    // Next Steps. No fallback to other prose sources.
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
      flmNotes: 'FLM-only note that must not appear',
      slmNotes: null,
    });
    const md = generateWeeklyForecast({
      views: [mkView(a1, [o1]), mkView(a2, [o2])],
      changeEvents: [],
      asOfDate: '2026-05-01',
    });
    // A1: chip line + SC Next Steps as the prose tail (after " | ").
    expect(md).toMatch(
      /- NextSteps Co \(\$100,000\) - .*Renewal: 2026-06-01.* \| Schedule QBR with new VP Finance/,
    );
    // A2: no SC Next Steps -> just chip line, no tail. FLM notes and
    // sentiment commentary are deliberately suppressed.
    expect(md).toContain('Sentiment Co ($80,000) - ');
    expect(md).not.toContain('Renewal at risk: legal review blocking PO');
    expect(md).not.toContain('FLM-only note that must not appear');
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

  // 2026-05-20 seventh-pass: Key Saves narrative was rendering as
  // truncated HTML tag-soup because (a) SFDC/Gainsight rich-text
  // fields ship with <p>, <b>, anchor wrappers and HTML entities,
  // and (b) the 160-char cap chopped sentences mid-word. The cleaner
  // strips markup and the new 500-char cap honors word boundaries.
  it('strips HTML and entities from SC Next Steps prose in Key Saves bullets', () => {
    // SC Next Steps is the only prose source for Key Saves bullets;
    // CSEs sometimes paste HTML-formatted next steps from Gainsight or
    // an email thread. The cleaner must strip tags / decode entities
    // so the bullet reads as prose, and the first sentence is kept.
    const acc = mkAccount({
      accountId: 'HTML',
      accountName: 'HTML Co',
    });
    const opp = mkOpportunity({
      accountId: 'HTML',
      closeDate: '2026-04-15',
      forecastMostLikely: -100_000,
      acvDelta: -100_000,
      scNextSteps:
        '<p></p><p class="x"><b>Schedule QBR</b> with new VP Finance by EOQ. <a href="https://x/y">link</a>&nbsp;Confirm Champify&#39;s renewal terms.</p>',
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [opp], {
          bucket: 'Saveable Risk',
          risk: { level: 'High', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    // No HTML tags or raw entities leak through.
    expect(md).not.toMatch(/<\/?(p|b|div|a|br)\b/);
    expect(md).not.toContain('&nbsp;');
    expect(md).not.toContain('&#39;');
    // First sentence of the cleaned SC Next Steps appears in the
    // prose tail of the bullet.
    expect(md).toContain('Schedule QBR with new VP Finance by EOQ.');
  });

  it('truncates very long SC Next Steps prose at a word boundary with an ellipsis', () => {
    // Two-sentence prose. First sentence (the only one kept) is long
    // enough to exceed the 200-char Key Saves cap and must truncate at
    // a word boundary with an ellipsis, not a mid-word chop.
    const longFirstSentence =
      'Schedule QBR with new VP Finance and align on the following workstreams ' +
      'detail '.repeat(40).trim();
    const acc = mkAccount({ accountId: 'LP', accountName: 'Long Prose Co' });
    const opp = mkOpportunity({
      accountId: 'LP',
      closeDate: '2026-04-15',
      forecastMostLikely: -100_000,
      acvDelta: -100_000,
      scNextSteps: longFirstSentence + '. Second sentence is dropped.',
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [opp], {
          bucket: 'Saveable Risk',
          risk: { level: 'High', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/Long Prose Co \(\$\d/);
    expect(md).toContain('…');
    expect(md).not.toMatch(/deta…/); // ellipsis lands after a whole word
    expect(md).not.toContain('Second sentence is dropped');
  });

  // 2026-05-20 sixth-pass: even after the churn-save scoping, a
  // renewal that *just transitioned to Closed/Won* during the window
  // belongs in WoW as good news for leadership — even though it has
  // dropped out of the churn-save universe in the current snapshot
  // (forecastCategory now reads "Closed"). DataStax is the verified
  // example. Without this exception the manager loses visibility of
  // booked renewals the week they close.
  it('includes recently closed-won renewals even when isChurnSaveTarget would now exclude them', () => {
    const acc = mkAccount({ accountId: 'CW', accountName: 'Just Booked Co' });
    const bookedRenewal = mkOpportunity({
      opportunityId: 'O-CW',
      accountId: 'CW',
      closeDate: '2026-04-15',
      // Current snapshot now shows the renewal as Closed — it's
      // booked, so the standard churn-save filter excludes it. The
      // closed-won-exception path must still surface the stage move.
      forecastCategory: 'Closed',
      forecastMostLikely: 0,
      acvDelta: 0,
    });
    const view = mkView(acc, [bookedRenewal], { bucket: 'Healthy' });
    const stageMove: ChangeEvent = {
      accountId: 'CW',
      opportunityId: 'O-CW',
      field: 'stageName',
      oldValue: '5.0 Propose',
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
    expect(md).toMatch(
      /\+ Just Booked Co - ↑ Stage 5\.0 Propose → 8\.0 - Closed\/Won \(Finance\)/,
    );
  });

  it('does NOT promote Closed/Lost-only accounts via the exception (no exception for losses)', () => {
    const acc = mkAccount({ accountId: 'LO', accountName: 'Conceded Co' });
    const lostRenewal = mkOpportunity({
      opportunityId: 'O-LO',
      accountId: 'LO',
      closeDate: '2026-04-15',
      forecastCategory: 'Closed Lost',
      forecastMostLikely: 0,
      acvDelta: 0,
    });
    const view = mkView(acc, [lostRenewal], { bucket: 'Confirmed Churn' });
    const stageMove: ChangeEvent = {
      accountId: 'LO',
      opportunityId: 'O-LO',
      field: 'stageName',
      oldValue: '5.0 Propose',
      newValue: '9.0 - Closed/Lost',
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

  // 2026-05-20 manager feedback: leadership needs a qualitative
  // health/trajectory summary inside each quarter block. The pure
  // renderer doesn't call an LLM; it just splices the upstream-
  // generated narrative string into a `Health Snapshot:` block
  // between `Hedge:` and `Accounts with Hedge`. The narrative is
  // built by the web API from Glean Adaptive chat over a trajectory
  // series (all snapshots in the quarter to date).
  describe('Health Snapshot section', () => {
    it('renders the Health Snapshot between Hedge and Accounts with Hedge when provided', () => {
      const acc = mkAccount({ accountId: 'A1', accountName: 'Account A' });
      const opp = mkOpportunity({ accountId: 'A1' });
      const md = generateWeeklyForecast({
        views: [mkView(acc, [opp])],
        changeEvents: [],
        asOfDate: AS_OF,
        healthSnapshot: {
          currentQuarter:
            'Q2 is flashing 14% over Plan and has widened by $150K over the last three weeks. Risk remains concentrated in Swing Education and Kustomer. No saves likely to close before EOQ without a leadership escalation.',
        },
      });
      // Ordering: Hedge: line ⟶ blank ⟶ Health Snapshot: ⟶ narrative
      // ⟶ blank ⟶ Accounts with Hedge.
      const lines = md.split('\n');
      const hedgeIdx = lines.findIndex((l) => l.startsWith('Hedge: '));
      const snapshotIdx = lines.findIndex((l) => l === 'Health Snapshot:');
      const accountsWithHedgeIdx = lines.findIndex((l) =>
        l.startsWith('Accounts with Hedge (churn-save renewals):'),
      );
      expect(hedgeIdx).toBeGreaterThan(-1);
      expect(snapshotIdx).toBeGreaterThan(hedgeIdx);
      expect(accountsWithHedgeIdx).toBeGreaterThan(snapshotIdx);
      // Blank line between Hedge and Health Snapshot header (visual
      // separation per 2026-05-20 user feedback).
      expect(lines[snapshotIdx - 1]).toBe('');
      // Narrative renders on the next line, indented with 2 spaces
      // (matches the bullet indentation used elsewhere in the script
      // so the block reads as a contiguous indented paragraph rather
      // than a flush-left wall of text).
      expect(lines[snapshotIdx + 1]).toMatch(/^  Q2 is flashing /);
      // Blank line between narrative and Accounts with Hedge.
      expect(lines[accountsWithHedgeIdx - 1]).toBe('');
    });

    it('omits the Health Snapshot section entirely when not provided', () => {
      const acc = mkAccount({ accountId: 'A1', accountName: 'Account A' });
      const opp = mkOpportunity({ accountId: 'A1' });
      const md = generateWeeklyForecast({
        views: [mkView(acc, [opp])],
        changeEvents: [],
        asOfDate: AS_OF,
      });
      expect(md).not.toContain('Health Snapshot:');
      // And the deterministic invariant that nothing inserted a stray
      // blank line between Hedge and Accounts with Hedge in the
      // no-snapshot path.
      expect(md).toMatch(
        /Hedge: \$\d.*\nAccounts with Hedge \(churn-save renewals\):/,
      );
    });

    it('omits the Health Snapshot section when narrative is empty / whitespace', () => {
      const acc = mkAccount({ accountId: 'A1', accountName: 'Account A' });
      const opp = mkOpportunity({ accountId: 'A1' });
      const md = generateWeeklyForecast({
        views: [mkView(acc, [opp])],
        changeEvents: [],
        asOfDate: AS_OF,
        healthSnapshot: { currentQuarter: '   ' },
      });
      expect(md).not.toContain('Health Snapshot:');
    });

    it('renders independent narratives per quarter', () => {
      const acc = mkAccount({ accountId: 'A1', accountName: 'Account A' });
      // One opp in current quarter (FY27 Q1) and one in next (FY27 Q2).
      const oppCurrent = mkOpportunity({
        opportunityId: 'O-CUR',
        accountId: 'A1',
        closeDate: '2026-04-15',
      });
      const oppNext = mkOpportunity({
        opportunityId: 'O-NEXT',
        accountId: 'A1',
        closeDate: '2026-06-15',
      });
      const md = generateWeeklyForecast({
        views: [mkView(acc, [oppCurrent, oppNext])],
        changeEvents: [],
        asOfDate: AS_OF,
        healthSnapshot: {
          currentQuarter: 'CURRENT-NARRATIVE-MARKER text for Q1.',
          nextQuarter: 'NEXT-NARRATIVE-MARKER text for Q2.',
        },
      });
      const currentIdx = md.indexOf('CURRENT-NARRATIVE-MARKER');
      const nextQuarterHeader = md.indexOf('Next Quarter:');
      const nextNarrativeIdx = md.indexOf('NEXT-NARRATIVE-MARKER');
      expect(currentIdx).toBeGreaterThan(-1);
      expect(currentIdx).toBeLessThan(nextQuarterHeader);
      expect(nextNarrativeIdx).toBeGreaterThan(nextQuarterHeader);
    });

    it('renders the stale-marker narrative verbatim (caller signals LLM failure here)', () => {
      // The pure renderer doesn't know what "failure" means — it just
      // prints the string. The caller (apps/web forecast route) is
      // responsible for substituting a clear marker like the one below
      // when the Glean Adaptive call throws or times out.
      const acc = mkAccount({ accountId: 'A1', accountName: 'Account A' });
      const opp = mkOpportunity({ accountId: 'A1' });
      const md = generateWeeklyForecast({
        views: [mkView(acc, [opp])],
        changeEvents: [],
        asOfDate: AS_OF,
        healthSnapshot: {
          currentQuarter: '[Narrative unavailable — Glean call failed]',
        },
      });
      expect(md).toContain(
        'Health Snapshot:\n  [Narrative unavailable — Glean call failed]',
      );
    });
  });

  // 2026-05-20 manager feedback: the WoW header was a static label; the
  // exec couldn't see at a glance whether the week was net-positive or
  // net-negative. Header now summarizes net forecast-ML change,
  // regressions, improvements, and booked count.
  it('summarizes net $ delta, regressions, improvements, and booked count in the WoW header', () => {
    const regAcc = mkAccount({ accountId: 'REG', accountName: 'Regression Co' });
    const regOpp = mkOpportunity({
      opportunityId: 'O-REG',
      accountId: 'REG',
      closeDate: '2026-04-15',
      forecastMostLikely: -82_327,
      acvDelta: -82_327,
    });
    const impAcc = mkAccount({ accountId: 'IMP', accountName: 'Improvement Co' });
    const impOpp = mkOpportunity({
      opportunityId: 'O-IMP',
      accountId: 'IMP',
      closeDate: '2026-04-15',
      forecastMostLikely: -749_973,
      acvDelta: -749_973,
    });
    const bookAcc = mkAccount({ accountId: 'BOOK', accountName: 'Booked Co' });
    const bookOpp = mkOpportunity({
      opportunityId: 'O-BOOK',
      accountId: 'BOOK',
      closeDate: '2026-04-15',
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
    });
    const events: ChangeEvent[] = [
      {
        accountId: 'REG',
        opportunityId: 'O-REG',
        field: 'forecastMostLikely',
        oldValue: -43_000,
        newValue: -82_327,
        occurredBetween: ['p', 'c'],
        category: 'forecast',
        label: 'ML moved',
      },
      {
        accountId: 'IMP',
        opportunityId: 'O-IMP',
        field: 'forecastMostLikely',
        oldValue: -850_000,
        newValue: -749_973,
        occurredBetween: ['p', 'c'],
        category: 'forecast',
        label: 'ML improved',
      },
      {
        accountId: 'BOOK',
        opportunityId: 'O-BOOK',
        field: 'stageName',
        oldValue: '7.0 - Closed/Won (Sales)',
        newValue: '8.0 - Closed/Won (Finance)',
        occurredBetween: ['p', 'c'],
        category: 'forecast',
        label: 'Stage moved',
      },
    ];
    const md = generateWeeklyForecast({
      views: [
        mkView(regAcc, [regOpp], { bucket: 'Saveable Risk' }),
        mkView(impAcc, [impOpp], { bucket: 'Saveable Risk' }),
        mkView(bookAcc, [bookOpp], { bucket: 'Saveable Risk' }),
      ],
      changeEvents: events,
      asOfDate: AS_OF,
    });
    // Net = -39,327 + 100,027 = +60,700. One booked (BOOK).
    expect(md).toMatch(
      /Week-over-week Changes - Improvements and increased risk: net \+\$60,700 \(regressions -\$39,327, improvements \+\$100,027, 1 booked\)/,
    );
  });

  it('renders "no movement this week" in the WoW header when nothing is in scope', () => {
    const acc = mkAccount({ accountId: 'Q', accountName: 'Quiet Co' });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [
          mkOpportunity({
            accountId: 'Q',
            closeDate: '2026-04-15',
            forecastMostLikely: -100_000,
            acvDelta: -100_000,
          }),
        ]),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toContain(
      'Week-over-week Changes - Improvements and increased risk: no movement this week',
    );
  });

  // 2026-05-20 manager feedback: Key Saves bullets were unreadable
  // multi-paragraph rich-text dumps. New contract: deterministic chip
  // line (Risk / Sentiment / Renewal / ML) plus one sentence from SC
  // Next Steps. No fallback to FLM/SLM notes, CSE sentiment commentary,
  // or Cerebro risk analysis.
  it('renders a chip line (Risk; Sentiment; Renewal; ML) for Key Saves bullets', () => {
    const acc = mkAccount({
      accountId: 'CHIP',
      accountName: 'Chip Co',
      cerebroRiskCategory: 'High',
      cseSentiment: 'Red',
    });
    const opp = mkOpportunity({
      accountId: 'CHIP',
      closeDate: '2026-04-15',
      acv: 200_000,
      forecastMostLikely: -150_000,
      acvDelta: -150_000,
      scNextSteps: null,
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [opp], {
          bucket: 'Saveable Risk',
          risk: { level: 'High', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toContain(
      'Chip Co ($200,000) - Risk: High; Sentiment: Red; Renewal: 2026-04-15; ML: -$150,000',
    );
  });

  it('appends only the first sentence of SC Next Steps to the chip line via " | "', () => {
    const acc = mkAccount({
      accountId: 'TAIL',
      accountName: 'Tail Co',
      cerebroRiskCategory: 'Medium',
      cseSentiment: 'Yellow',
    });
    const opp = mkOpportunity({
      accountId: 'TAIL',
      closeDate: '2026-04-15',
      acv: 90_000,
      forecastMostLikely: -50_000,
      acvDelta: -50_000,
      scNextSteps:
        'Schedule QBR with new VP Finance by EOQ. Second sentence we drop. Third also dropped.',
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(acc, [opp], {
          bucket: 'Saveable Risk',
          risk: { level: 'Medium', source: 'cerebro', rationale: '' },
        }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toContain(
      'Tail Co ($90,000) - Risk: Medium; Sentiment: Yellow; Renewal: 2026-04-15; ML: -$50,000 | Schedule QBR with new VP Finance by EOQ.',
    );
    expect(md).not.toContain('Second sentence we drop');
  });

  // 2026-05-20 manager feedback: Key Saves bullets were showing
  // upsell / amendment opps with past-due close dates because
  // topAccountsToCloseGap only filtered on colorBand + acv. Leadership
  // can't "save" an Amendment / New Business / Contracted Ramp deal —
  // the section is for renewals only. We now gate Key Saves on the
  // same renewal + carried-forecast-category checks the Hedge /
  // Close-Gap sections use.
  it('excludes Amendment / New Business opps from Key Saves (renewals only)', () => {
    const upsellAcc = mkAccount({
      accountId: 'UP',
      accountName: 'Upsell Co',
      cseSentiment: 'Red',
    });
    const upsellOpp = mkOpportunity({
      opportunityId: 'O-UP',
      accountId: 'UP',
      type: 'Amendment',
      acv: 250_000,
      closeDate: '2026-04-15',
    });
    const renewalAcc = mkAccount({
      accountId: 'RN',
      accountName: 'Renewal Co',
      cseSentiment: 'Red',
    });
    const renewalOpp = mkOpportunity({
      opportunityId: 'O-RN',
      accountId: 'RN',
      type: 'Renewal',
      acv: 100_000,
      closeDate: '2026-04-15',
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(upsellAcc, [upsellOpp], { bucket: 'Saveable Risk' }),
        mkView(renewalAcc, [renewalOpp], { bucket: 'Saveable Risk' }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    // Slice the Key Saves block so we don't pick up "Upsell Co" from
    // some other section (none today, but future-proof).
    const keySavesBlock = md.slice(md.indexOf('Key Saves/Improvements'));
    expect(keySavesBlock).not.toContain('Upsell Co');
    expect(keySavesBlock).toContain('Renewal Co');
  });

  it('excludes opps with a closed / omitted forecast category from Key Saves', () => {
    const closedAcc = mkAccount({
      accountId: 'CL',
      accountName: 'Closed Co',
      cseSentiment: 'Red',
    });
    const closedOpp = mkOpportunity({
      opportunityId: 'O-CL',
      accountId: 'CL',
      type: 'Renewal',
      acv: 300_000,
      closeDate: '2026-04-15',
      forecastCategory: 'Closed Won',
    });
    const liveAcc = mkAccount({
      accountId: 'LV',
      accountName: 'Live Renewal Co',
      cseSentiment: 'Red',
    });
    const liveOpp = mkOpportunity({
      opportunityId: 'O-LV',
      accountId: 'LV',
      type: 'Renewal',
      acv: 100_000,
      closeDate: '2026-04-15',
      forecastCategory: 'Commit',
    });
    const md = generateWeeklyForecast({
      views: [
        mkView(closedAcc, [closedOpp], { bucket: 'Saveable Risk' }),
        mkView(liveAcc, [liveOpp], { bucket: 'Saveable Risk' }),
      ],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    const keySavesBlock = md.slice(md.indexOf('Key Saves/Improvements'));
    expect(keySavesBlock).not.toContain('Closed Co');
    expect(keySavesBlock).toContain('Live Renewal Co');
  });

  it('omits chips for missing fields (sparse account still renders compact bullet)', () => {
    const acc = mkAccount({
      accountId: 'SPARSE',
      accountName: 'Sparse Co',
      cerebroRiskCategory: null,
      cseSentiment: 'Green',
    });
    const opp = mkOpportunity({
      accountId: 'SPARSE',
      closeDate: '2026-06-01',
      acv: 50_000,
      forecastMostLikely: 0,
      scNextSteps: null,
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [opp])],
      changeEvents: [],
      asOfDate: '2026-05-01',
    });
    // No Risk chip (null), no ML chip (0), no prose tail. Sentiment +
    // Renewal still present.
    expect(md).toContain('Sparse Co ($50,000) - Sentiment: Green; Renewal: 2026-06-01');
    expect(md).not.toMatch(/Sparse Co .*Risk:/);
    expect(md).not.toMatch(/Sparse Co .*ML:/);
    expect(md).not.toMatch(/Sparse Co .* \| /);
  });
});

// 2026-05-20 — Health Snapshot supporting helpers. computeQuarterKpis
// surfaces the same Plan / Flash / Gap math the renderer uses as a
// reusable struct so the web-app trajectory loader can build a
// per-day series for the Glean Adaptive narrative call without
// re-implementing the bucket / churn-component logic.
// 2026-05-20 manager feedback (second pass): the Gap to Plan line
// should read as `% to Plan` per Sam Lawley's prior-art vocabulary
// ("Flashing 137% to plan") — 100% means Flash exactly equals Plan,
// >100% means losing more than budgeted ("over plan", bad), <100%
// means losing less than budgeted ("under plan", beating). This is
// inverted from intuitive English ("over plan" sounds positive) but
// matches the house convention.
describe('Gap to Plan percentage to plan', () => {
  it('renders ">100% over plan" when Flash is worse (further from zero) than Plan', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({
      accountId: 'A1',
      type: 'Renewal',
      knownChurnUSD: 2_435_022,
      forecastMostLikely: 0,
      acvDelta: 0,
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [opp], { bucket: 'Confirmed Churn' })],
      changeEvents: [],
      asOfDate: AS_OF,
      plan: { currentQuarterUSD: -2_164_000 },
    });
    // Flash = -$2,435,022, Plan = -$2,164,000.
    // |Flash| / |Plan| = 2435022 / 2164000 = 112.5% → "113% over plan".
    // Gap = -$271,022 (Flash worse than Plan, so dollar gap is negative).
    expect(md).toMatch(/Gap to Plan: -\$271,022 \(113% over plan\)/);
  });

  it('renders "<100% under plan" when Flash is better (closer to zero) than Plan', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({
      accountId: 'A1',
      type: 'Renewal',
      knownChurnUSD: 1_800_000,
      forecastMostLikely: 0,
      acvDelta: 0,
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [opp], { bucket: 'Confirmed Churn' })],
      changeEvents: [],
      asOfDate: AS_OF,
      plan: { currentQuarterUSD: -2_164_000 },
    });
    // Flash = -$1,800,000, Plan = -$2,164,000.
    // |Flash| / |Plan| = 1800 / 2164 = 83.2% → "83% under plan" (beating).
    // Gap = +$364,000 (Flash closer to zero than Plan).
    expect(md).toMatch(/Gap to Plan: \+\$364,000 \(83% under plan\)/);
  });

  it('renders "(at plan)" when Flash exactly matches Plan', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({
      accountId: 'A1',
      type: 'Renewal',
      knownChurnUSD: 2_000_000,
      forecastMostLikely: 0,
      acvDelta: 0,
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [opp], { bucket: 'Confirmed Churn' })],
      changeEvents: [],
      asOfDate: AS_OF,
      plan: { currentQuarterUSD: -2_000_000 },
    });
    expect(md).toContain('Gap to Plan: $0 (at plan)');
  });

  it('rounds to whole percent (small variance still emits an integer)', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({
      accountId: 'A1',
      type: 'Renewal',
      knownChurnUSD: 2_100_000,
      forecastMostLikely: 0,
      acvDelta: 0,
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [opp], { bucket: 'Confirmed Churn' })],
      changeEvents: [],
      asOfDate: AS_OF,
      plan: { currentQuarterUSD: -2_000_000 },
    });
    // Flash = -$2.1M, Plan = -$2.0M → 105% over plan.
    expect(md).toMatch(/Gap to Plan: -\$100,000 \(105% over plan\)/);
  });

  it('omits the percentage when Plan is undefined (preserves the existing fill-in placeholder)', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({ accountId: 'A1' });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [opp])],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toContain('Gap to Plan: [fill in once Plan is set]');
    expect(md).not.toMatch(/Gap to Plan:.*% (under|over) plan/);
  });

  it('omits the percentage when Plan is 0 (degenerate divide-by-zero guard)', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({
      accountId: 'A1',
      type: 'Renewal',
      knownChurnUSD: 50_000,
      forecastMostLikely: 0,
      acvDelta: 0,
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [opp], { bucket: 'Confirmed Churn' })],
      changeEvents: [],
      asOfDate: AS_OF,
      plan: { currentQuarterUSD: 0 },
    });
    // Plan = $0 → Gap = Flash = -$50,000, but no percentage rendered.
    expect(md).toContain('Gap to Plan: -$50,000');
    expect(md).not.toMatch(/Gap to Plan:.*%/);
  });
});

// 2026-05-20 manager feedback: the top-line `Hedge:` KPI was double-
// counting expansion hedge from Amendment / New Business / Upsell
// opps, inflating the renewal-save Hedge figure leadership reads.
// Gate to the same renewal + carried-forecast-category lens used by
// the `Accounts with Hedge` section below.
describe('Hedge KPI gating', () => {
  it('excludes expansion-hedge dollars from non-renewal opps', () => {
    const acc1 = mkAccount({ accountId: 'A1', accountName: 'Renewal Co' });
    const renewalOpp = mkOpportunity({
      accountId: 'A1',
      opportunityId: 'O1',
      type: 'Renewal',
      forecastHedgeUSD: 100_000,
      forecastCategory: 'Best Case',
    });
    const acc2 = mkAccount({ accountId: 'A2', accountName: 'Upsell Co' });
    const upsellOpp = mkOpportunity({
      accountId: 'A2',
      opportunityId: 'O2',
      type: 'New Business',
      forecastHedgeUSD: 250_000,
      forecastCategory: 'Best Case',
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc1, [renewalOpp]), mkView(acc2, [upsellOpp])],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    // Top-line Hedge should be $100K (renewal only), not $350K.
    expect(md).toMatch(/Hedge: \$100,000/);
    expect(md).not.toMatch(/Hedge: \$350,000/);
  });

  it('excludes hedge on renewal opps in dropped forecast categories (e.g., Omitted, Closed)', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const carriedOpp = mkOpportunity({
      accountId: 'A1',
      opportunityId: 'O1',
      type: 'Renewal',
      forecastHedgeUSD: 75_000,
      forecastCategory: 'Best Case',
    });
    const omittedOpp = mkOpportunity({
      accountId: 'A1',
      opportunityId: 'O2',
      type: 'Renewal',
      forecastHedgeUSD: 500_000,
      forecastCategory: 'Omitted',
    });
    const md = generateWeeklyForecast({
      views: [mkView(acc, [carriedOpp, omittedOpp])],
      changeEvents: [],
      asOfDate: AS_OF,
    });
    expect(md).toMatch(/Hedge: \$75,000/);
  });
});

describe('fiscalQuarterStart', () => {
  it('returns Feb 1 of FY-1 for Q1 (Zuora FY starts February)', () => {
    expect(
      fiscalQuarterStart({ fy: 2027, q: 1, key: '2027-Q1', label: 'FY27 Q1' }),
    ).toBe('2026-02-01');
  });
  it('returns May 1 of FY-1 for Q2', () => {
    expect(
      fiscalQuarterStart({ fy: 2027, q: 2, key: '2027-Q2', label: 'FY27 Q2' }),
    ).toBe('2026-05-01');
  });
  it('returns Aug 1 of FY-1 for Q3', () => {
    expect(
      fiscalQuarterStart({ fy: 2027, q: 3, key: '2027-Q3', label: 'FY27 Q3' }),
    ).toBe('2026-08-01');
  });
  it('returns Nov 1 of FY-1 for Q4 (Nov–Jan window crosses calendar boundary)', () => {
    // FY27 Q4 = Nov 2026, Dec 2026, Jan 2027. Start = Nov 1, 2026.
    expect(
      fiscalQuarterStart({ fy: 2027, q: 4, key: '2027-Q4', label: 'FY27 Q4' }),
    ).toBe('2026-11-01');
  });
  it('round-trips with fiscalQuarterFromDate (start-of-quarter date maps back to same quarter)', () => {
    const fq = fiscalQuarterFromDate('2026-05-20')!;
    const start = fiscalQuarterStart(fq);
    const fqAtStart = fiscalQuarterFromDate(start)!;
    expect(fqAtStart.key).toBe(fq.key);
  });
});

describe('computeQuarterKpis', () => {
  it('produces a snapshot whose Plan/Flash/Gap match the renderer for the same inputs', () => {
    // Confirmed-churn renewal in FY27 Q1, -$100K known churn. Account
    // ML override stays null so churn flash = -knownChurn.
    const acc = mkAccount({ accountId: 'CK', accountName: 'Confirmed Churn Co' });
    const opp = mkOpportunity({
      opportunityId: 'O-CK',
      accountId: 'CK',
      type: 'Renewal',
      closeDate: '2026-04-15',
      knownChurnUSD: 100_000,
      acvDelta: 0,
      forecastMostLikely: 0,
      availableToRenewUSD: 300_000,
    });
    const view = mkView(acc, [opp], { bucket: 'Confirmed Churn' });
    const kpis = computeQuarterKpis([view], AS_OF, 'current', -2_000_000);
    expect(kpis.fiscalQuarterLabel).toBe('FY27 Q1');
    // Flash is negative (the renderer prints it directly as signed
    // USD). One -$100K known-churn opp.
    expect(kpis.flashUSD).toBe(-100_000);
    // Total Risk = -(sum of ATR for confirmed/saveable). One $300K
    // ATR on a Confirmed-Churn account.
    expect(kpis.totalRiskUSD).toBe(-300_000);
    // Gap = Flash - Plan. Both negative.
    expect(kpis.gapUSD).toBe(-100_000 - -2_000_000);
    expect(kpis.accountCount).toBe(1);
    expect(kpis.opportunityCount).toBe(1);
  });

  it('reports planUSD=null and gapUSD=null when caller passes null Plan', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({ accountId: 'A1' });
    const kpis = computeQuarterKpis([mkView(acc, [opp])], AS_OF, 'current', null);
    expect(kpis.planUSD).toBeNull();
    expect(kpis.gapUSD).toBeNull();
  });

  it('counts each account once even when it has multiple opps in the quarter (worst-band wins)', () => {
    const acc = mkAccount({
      accountId: 'MULTI',
      accountName: 'Multi-Opp Co',
      cseSentiment: 'Red',
    });
    const opp1 = mkOpportunity({
      opportunityId: 'O-1',
      accountId: 'MULTI',
      closeDate: '2026-04-15',
    });
    const opp2 = mkOpportunity({
      opportunityId: 'O-2',
      accountId: 'MULTI',
      closeDate: '2026-04-20',
    });
    const view = mkView(acc, [opp1, opp2], { bucket: 'Saveable Risk' });
    const kpis = computeQuarterKpis([view], AS_OF, 'current', null);
    expect(kpis.accountCount).toBe(1);
    expect(kpis.opportunityCount).toBe(2);
    expect(kpis.redAccountCount).toBe(1);
    expect(kpis.yellowAccountCount).toBe(0);
  });

  it('returns an empty-quarter snapshot when no opps land in the chosen quarter', () => {
    // Opp closeDate in Q2; we ask for current = Q1.
    const acc = mkAccount({ accountId: 'A1' });
    const opp = mkOpportunity({ accountId: 'A1', closeDate: '2026-06-15' });
    const kpis = computeQuarterKpis([mkView(acc, [opp])], AS_OF, 'current', null);
    expect(kpis.fiscalQuarterLabel).toBe('FY27 Q1');
    expect(kpis.flashUSD).toBe(0);
    expect(kpis.totalRiskUSD).toBe(0);
    expect(kpis.hedgeUSD).toBe(0);
    expect(kpis.accountCount).toBe(0);
    expect(kpis.opportunityCount).toBe(0);
    expect(kpis.redAccountCount).toBe(0);
  });

  it('respects quarter selection (current vs next)', () => {
    const acc = mkAccount({ accountId: 'A1' });
    const oppCurrent = mkOpportunity({
      opportunityId: 'O-C',
      accountId: 'A1',
      closeDate: '2026-04-15',
      forecastHedgeUSD: 10_000,
    });
    const oppNext = mkOpportunity({
      opportunityId: 'O-N',
      accountId: 'A1',
      closeDate: '2026-06-15',
      forecastHedgeUSD: 50_000,
    });
    const view = mkView(acc, [oppCurrent, oppNext]);
    const current = computeQuarterKpis([view], AS_OF, 'current', null);
    const next = computeQuarterKpis([view], AS_OF, 'next', null);
    expect(current.hedgeUSD).toBe(10_000);
    expect(next.hedgeUSD).toBe(50_000);
    expect(current.fiscalQuarterLabel).toBe('FY27 Q1');
    expect(next.fiscalQuarterLabel).toBe('FY27 Q2');
  });
});
