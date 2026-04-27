import type {
  CanonicalAccount,
  CanonicalOpportunity,
  CSESentiment,
  CerebroRiskCategory,
  CerebroRisks,
  SourceLink,
} from '@mdas/canonical';

const FRANCHISE = 'Expand 3';

const daysAgoIso = (d: number) =>
  new Date(Date.now() - d * 86400 * 1000).toISOString();
const daysAheadIso = (d: number) =>
  new Date(Date.now() + d * 86400 * 1000).toISOString();
const dateOnly = (iso: string) => iso.slice(0, 10);

const allFalse: CerebroRisks = {
  utilizationRisk: false,
  engagementRisk: false,
  suiteRisk: false,
  shareRisk: false,
  legacyTechRisk: false,
  expertiseRisk: false,
  pricingRisk: false,
};

function sfdcLinks(name: string, sfid: string): SourceLink[] {
  return [
    {
      source: 'salesforce',
      label: 'SFDC Account',
      url: `https://zuora.lightning.force.com/lightning/r/Account/${sfid}/view`,
    },
    {
      source: 'cerebro',
      label: 'Cerebro (via Glean)',
      url: `https://app.glean.com/search?q=${encodeURIComponent(name + ' Cerebro Risk')}`,
    },
    {
      source: 'gainsight',
      label: 'Gainsight Company',
      url: `https://zuora.gainsightcloud.com/v1/ui/cs#/360/${sfid}`,
    },
  ];
}

interface Build {
  id: string;
  sfid: string;
  name: string;
  sentiment: CSESentiment;
  cerebroRisk: CerebroRiskCategory;
  cerebroRisks: CerebroRisks;
  arr: number;
  products: string[];
  cseName: string;
  ownerName: string;
  commentary: string;
  commentaryDaysAgo: number;
  riskAnalysis: string | null;
  subMetrics?: Record<string, number | string | boolean | null>;
  workshops?: { date: string; type?: string }[];
  meetings?: { source: 'calendar' | 'zoom' | 'staircase'; title: string; daysAgo: number }[];
  tasks?: { title: string; status: string; dueDaysAhead?: number; ownerName?: string }[];
  opps: {
    id: string;
    name: string;
    type: string;
    stage: string;
    stageNum: number;
    closeDaysAhead: number;
    acv?: number;
    atr?: number;
    forecastMostLikely?: number;
    confidence?: CanonicalOpportunity['mostLikelyConfidence'];
    hedge?: number;
    acvDelta?: number;
    knownChurn?: number;
    productLine?: string;
    flmNotes?: string;
    scNextSteps?: string;
    salesEngineerName?: string | null;
    fullChurnNotificationToOwnerDate?: string | null;
    fullChurnFinalEmailSentDate?: string | null;
    churnDownsellReason?: string | null;
  }[];
  isConfirmedChurn?: boolean;
  churnReason?: string;
  churnReasonSummary?: string;
  churnDate?: string;
}

function buildAccount(
  b: Build,
): { account: CanonicalAccount; opportunities: CanonicalOpportunity[] } {
  const links = sfdcLinks(b.name, b.sfid);
  const account: CanonicalAccount = {
    accountId: b.sfid,
    salesforceAccountId: b.sfid.slice(0, 15),
    accountName: b.name,
    zuoraTenantId: `tenant-${b.id}`,
    accountOwner: { id: 'U-OWN-' + b.id, name: b.ownerName },
    assignedCSE: { id: 'U-CSE-' + b.id, name: b.cseName },
    csCoverage: 'CSE',
    franchise: FRANCHISE,
    cseSentiment: b.sentiment,
    cseSentimentCommentary: b.commentary,
    cseSentimentLastUpdated: daysAgoIso(b.commentaryDaysAgo),
    cseSentimentCommentaryLastUpdated: daysAgoIso(b.commentaryDaysAgo),
    cerebroRiskCategory: b.cerebroRisk,
    cerebroRiskAnalysis: b.riskAnalysis,
    cerebroRisks: b.cerebroRisks,
    cerebroSubMetrics: b.subMetrics ?? {},
    allTimeARR: b.arr,
    activeProductLines: b.products,
    engagementMinutes30d: 60 + (b.id.length % 5) * 30,
    engagementMinutes90d: 200 + (b.id.length % 5) * 80,
    isConfirmedChurn: b.isConfirmedChurn ?? b.sentiment === 'Confirmed Churn',
    churnReason: b.churnReason ?? null,
    churnReasonSummary: b.churnReasonSummary ?? null,
    churnDate: b.churnDate ?? null,
    gainsightTasks: (b.tasks ?? []).map((t, i) => ({
      id: `T-${b.id}-${i}`,
      title: t.title,
      owner: t.ownerName ? { id: 'U-OWN-' + b.id, name: t.ownerName } : null,
      dueDate: t.dueDaysAhead != null ? daysAheadIso(t.dueDaysAhead).slice(0, 10) : null,
      status: t.status,
      ctaId: `CTA-${b.id}-${i}`,
    })),
    workshops: (b.workshops ?? []).map((w, i) => ({
      id: `W-${b.id}-${i}`,
      engagementType: w.type ?? 'Quarterly Workshop',
      status: 'Completed',
      workshopDate: w.date,
    })),
    recentMeetings: (b.meetings ?? []).map((m) => ({
      source: m.source,
      title: m.title,
      startTime: daysAgoIso(m.daysAgo),
      attendees: ['nick.wilbur@zuora.com', 'customer@example.com'],
      summary: `Auto-summary: ${m.title}`,
      url: null,
    })),
    accountPlanLinks: [
      {
        title: `${b.name} — Account Plan`,
        url: `https://docs.google.com/document/d/${b.id}-plan`,
        lastModified: daysAgoIso(20),
      },
    ],
    sourceLinks: links,
    lastUpdated: new Date().toISOString(),
  };

  const opportunities: CanonicalOpportunity[] = b.opps.map((o) => ({
    opportunityId: o.id,
    opportunityName: o.name,
    accountId: b.sfid,
    type: o.type,
    stageName: o.stage,
    stageNum: o.stageNum,
    closeDate: dateOnly(daysAheadIso(o.closeDaysAhead)),
    closeQuarter: ((): string => {
      const m = new Date(daysAheadIso(o.closeDaysAhead)).getMonth();
      return ['Q1', 'Q1', 'Q1', 'Q2', 'Q2', 'Q2', 'Q3', 'Q3', 'Q3', 'Q4', 'Q4', 'Q4'][m]!;
    })(),
    fiscalYear: new Date(daysAheadIso(o.closeDaysAhead)).getFullYear(),
    acv: o.acv ?? null,
    availableToRenewUSD: o.atr ?? null,
    forecastMostLikely: o.forecastMostLikely ?? null,
    forecastMostLikelyOverride: null,
    mostLikelyConfidence: o.confidence ?? 'Medium',
    forecastHedgeUSD: o.hedge ?? null,
    acvDelta: o.acvDelta ?? 0,
    knownChurnUSD: o.knownChurn ?? 0,
    productLine: o.productLine ?? null,
    flmNotes: o.flmNotes ?? '',
    slmNotes: null,
    scNextSteps: o.scNextSteps ?? '',
    salesEngineer:
      o.salesEngineerName === undefined
        ? { id: 'U-CSE-' + b.id, name: b.cseName }
        : o.salesEngineerName === null
          ? null
          : { id: 'U-SE-' + b.id, name: o.salesEngineerName },
    fullChurnNotificationToOwnerDate: o.fullChurnNotificationToOwnerDate ?? null,
    fullChurnFinalEmailSentDate: o.fullChurnFinalEmailSentDate ?? null,
    churnDownsellReason: o.churnDownsellReason ?? null,
    sourceLinks: [
      {
        source: 'salesforce',
        label: 'SFDC Opportunity',
        url: `https://zuora.lightning.force.com/lightning/r/Opportunity/${o.id}/view`,
      },
    ],
    lastUpdated: new Date().toISOString(),
  }));

  return { account, opportunities };
}

const builds: Build[] = [
  // 1) Confirmed Churn
  {
    id: '01',
    sfid: '0010000000000001AAA',
    name: 'Northwind Media',
    sentiment: 'Confirmed Churn',
    cerebroRisk: 'Critical',
    cerebroRisks: { ...allFalse, utilizationRisk: true, engagementRisk: true, shareRisk: true, pricingRisk: true },
    arr: 850_000,
    products: ['Zuora Billing'],
    cseName: 'Priya Patel',
    ownerName: 'Marcus Cole',
    commentary: 'STATE AND RENEWAL RISK: Confirmed non-renewal due to platform consolidation.\nACTION PLAN: Manage knowledge transfer; preserve relationship for future re-entry.',
    commentaryDaysAgo: 6,
    riskAnalysis: 'Customer is consolidating onto a competing platform. Final email sent. Confirmed loss of $850K ARR.',
    subMetrics: { 'Executive Meeting Count (90d)': 1, 'Projected Billing Utilization (%)': 30 },
    workshops: [{ date: daysAgoIso(180) }],
    meetings: [{ source: 'zoom', title: 'Final wind-down call', daysAgo: 4 }],
    isConfirmedChurn: true,
    churnReason: 'Platform Consolidation',
    churnReasonSummary: 'Migrating to in-house billing during M&A integration.',
    churnDate: daysAheadIso(60).slice(0, 10),
    opps: [
      {
        id: 'OPP-01-CHURN',
        name: 'Northwind FY26 Renewal',
        type: 'Renewal',
        stage: 'Closed Lost',
        stageNum: 9,
        closeDaysAhead: 60,
        acv: 850_000,
        atr: 850_000,
        forecastMostLikely: 0,
        confidence: 'Closed',
        hedge: 0,
        acvDelta: -850_000,
        knownChurn: 850_000,
        productLine: 'Zuora Billing',
        flmNotes: 'Lost to in-house build post-M&A.',
        scNextSteps: 'Wind-down: data export plan in flight.',
        fullChurnNotificationToOwnerDate: daysAgoIso(20).slice(0, 10),
        fullChurnFinalEmailSentDate: daysAgoIso(5).slice(0, 10),
        churnDownsellReason: 'Platform Consolidation',
      },
    ],
  },

  // 2) Saveable Risk Critical
  {
    id: '02',
    sfid: '0010000000000002AAA',
    name: 'Helios Streaming',
    sentiment: 'Red',
    cerebroRisk: 'Critical',
    cerebroRisks: { ...allFalse, utilizationRisk: true, engagementRisk: true, suiteRisk: true, legacyTechRisk: true, pricingRisk: true },
    arr: 1_400_000,
    products: ['Zuora Billing'],
    cseName: 'Daniel Kim',
    ownerName: 'Avery Singh',
    commentary: 'STATE AND RENEWAL RISK: Major executive change; advocacy lost.',
    commentaryDaysAgo: 22,
    riskAnalysis: 'Sponsor turnover plus Orders API legacy dependencies. Cost of billing exceeds 9%. Need exec realignment within 60 days.',
    subMetrics: {
      'Executive Meeting Count (90d)': 0,
      'Projected Billing Utilization (%)': 45,
      'Orders API Usage (%)': 70,
      'Cost of Billing %': 9.4,
    },
    workshops: [{ date: daysAgoIso(400), type: 'Tech Workshop' }],
    meetings: [{ source: 'staircase', title: 'CSM cadence', daysAgo: 14 }],
    tasks: [],
    opps: [
      {
        id: 'OPP-02-REN',
        name: 'Helios FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 2 - Discovery',
        stageNum: 2,
        closeDaysAhead: 75,
        acv: 1_400_000,
        atr: 1_400_000,
        forecastMostLikely: 700_000,
        confidence: 'Low',
        hedge: 1_000_000,
        acvDelta: -200_000,
        productLine: 'Zuora Billing',
        flmNotes: '',
        scNextSteps: '',
      },
    ],
  },

  // 3) Saveable Risk Critical (with FLM notes present)
  {
    id: '03',
    sfid: '0010000000000003AAA',
    name: 'Bridgewater Logistics',
    sentiment: 'Red',
    cerebroRisk: 'Critical',
    cerebroRisks: { ...allFalse, utilizationRisk: true, suiteRisk: true, shareRisk: true, expertiseRisk: true },
    arr: 950_000,
    products: ['Zuora Billing', 'Zuora Revenue'],
    cseName: 'Priya Patel',
    ownerName: 'Marcus Cole',
    commentary: 'STATE AND RENEWAL RISK: Cost concerns + competing RFP.\nACTION PLAN: Pricing review by 4/30; sponsor escalation to CFO.',
    commentaryDaysAgo: 5,
    riskAnalysis: 'Active competitive evaluation; we are the incumbent but pricing perceived as high. Cost of billing 8.1%.',
    subMetrics: { 'Executive Meeting Count (90d)': 2, 'Cost of Billing %': 8.1 },
    workshops: [{ date: daysAgoIso(80) }],
    meetings: [{ source: 'calendar', title: 'CFO sync', daysAgo: 9 }],
    opps: [
      {
        id: 'OPP-03-REN',
        name: 'Bridgewater FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 4 - Propose',
        stageNum: 4,
        closeDaysAhead: 40,
        acv: 950_000,
        atr: 950_000,
        forecastMostLikely: 750_000,
        confidence: 'Medium',
        hedge: 850_000,
        acvDelta: -100_000,
        productLine: 'Zuora Billing',
        flmNotes: 'Defensive renewal — pricing concession requested. Sponsor support is moderate. Need CFO meeting.',
        scNextSteps: 'Schedule CFO meeting next Tuesday; deliver TCO comparison.',
      },
    ],
  },

  // 4) Saveable Risk High
  {
    id: '04',
    sfid: '0010000000000004AAA',
    name: 'Kestrel Energy',
    sentiment: 'Yellow',
    cerebroRisk: 'High',
    cerebroRisks: { ...allFalse, suiteRisk: true, legacyTechRisk: true },
    arr: 600_000,
    products: ['Zuora Billing'],
    cseName: 'Daniel Kim',
    ownerName: 'Lara Chen',
    commentary: 'STATE AND RENEWAL RISK: usage stagnant. \nACTION PLAN: drive Invoice Settlement adoption Q2.',
    commentaryDaysAgo: 12,
    riskAnalysis: 'Suite expansion stalled — Invoice Settlement and CPQ never adopted. Engagement steady but no exec investment.',
    subMetrics: {
      'Executive Meeting Count (90d)': 1,
      'Projected Billing Utilization (%)': 78,
      'Invoice Settlement': false,
    },
    workshops: [{ date: daysAgoIso(45) }],
    opps: [
      {
        id: 'OPP-04-REN',
        name: 'Kestrel FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 3 - Validate',
        stageNum: 3,
        closeDaysAhead: 110,
        acv: 600_000,
        atr: 600_000,
        forecastMostLikely: 600_000,
        confidence: 'Medium',
        hedge: 600_000,
        acvDelta: 0,
        productLine: 'Zuora Billing',
        flmNotes: 'Flat renewal expected; expand 3 working IS adoption story.',
        scNextSteps: 'Workshop Invoice Settlement value w/ controller team.',
      },
    ],
  },

  // 5) Saveable Risk High
  {
    id: '05',
    sfid: '0010000000000005AAA',
    name: 'Atlas Retail Group',
    sentiment: 'Yellow',
    cerebroRisk: 'High',
    cerebroRisks: { ...allFalse, engagementRisk: true, expertiseRisk: true },
    arr: 720_000,
    products: ['Zuora Billing', 'Zephr'],
    cseName: 'Priya Patel',
    ownerName: 'Avery Singh',
    commentary: 'STATE AND RENEWAL RISK: low engagement, support ticket spike.',
    commentaryDaysAgo: 18,
    riskAnalysis: 'Tickets up 35% QoQ; account team coverage thin. No TAM. Need expert support.',
    subMetrics: {
      'Executive Meeting Count (90d)': 0,
      'Technical Account Manager': false,
      'Premium Elite Support': false,
    },
    workshops: [],
    meetings: [{ source: 'staircase', title: 'Support escalation review', daysAgo: 11 }],
    opps: [
      {
        id: 'OPP-05-REN',
        name: 'Atlas FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 2 - Discovery',
        stageNum: 2,
        closeDaysAhead: 90,
        acv: 720_000,
        atr: 720_000,
        forecastMostLikely: 720_000,
        confidence: 'Medium',
        hedge: 700_000,
        acvDelta: 0,
        productLine: 'Zuora Billing',
        flmNotes: 'Hygiene gap: workshop overdue 12 months; no TAM.',
        scNextSteps: 'Engage TAM PM to scope upsell; book exec review.',
      },
    ],
  },

  // 6) Healthy with active upsell opp
  {
    id: '06',
    sfid: '0010000000000006AAA',
    name: 'Lumen Health',
    sentiment: 'Green',
    cerebroRisk: 'Low',
    cerebroRisks: allFalse,
    arr: 1_100_000,
    products: ['Zuora Billing', 'Zuora Revenue'],
    cseName: 'Sarah Greene',
    ownerName: 'Lara Chen',
    commentary: 'STATE AND RENEWAL RISK: clean renewal expected.\nACTION PLAN: cross-sell Zephr.',
    commentaryDaysAgo: 8,
    riskAnalysis: 'Strong adoption across Billing + Revenue. Sponsor stable. Whitespace in Zephr.',
    subMetrics: { 'Executive Meeting Count (90d)': 4, 'Projected Billing Utilization (%)': 84 },
    workshops: [{ date: daysAgoIso(20), type: 'Zephr Discovery' }],
    meetings: [{ source: 'zoom', title: 'Zephr scoping', daysAgo: 5 }],
    opps: [
      {
        id: 'OPP-06-UP',
        name: 'Lumen Zephr Cross-Sell',
        type: 'Cross-Sell',
        stage: 'Stage 3 - Validate',
        stageNum: 3,
        closeDaysAhead: 100,
        acv: 350_000,
        atr: 0,
        forecastMostLikely: 250_000,
        confidence: 'Medium',
        hedge: 200_000,
        acvDelta: 350_000,
        productLine: 'Zephr',
        flmNotes: 'Active cross-sell motion; champion identified.',
        scNextSteps: 'Solution review next sprint.',
      },
      {
        id: 'OPP-06-REN',
        name: 'Lumen FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 5 - Negotiate',
        stageNum: 5,
        closeDaysAhead: 150,
        acv: 1_100_000,
        atr: 1_100_000,
        forecastMostLikely: 1_150_000,
        confidence: 'High',
        hedge: 1_100_000,
        acvDelta: 50_000,
        productLine: 'Zuora Billing',
        flmNotes: 'Clean renewal with modest uplift.',
        scNextSteps: 'Awaiting paper.',
      },
    ],
  },

  // 7) Healthy with active upsell
  {
    id: '07',
    sfid: '0010000000000007AAA',
    name: 'Cobalt Subscription Co',
    sentiment: 'Green',
    cerebroRisk: 'Low',
    cerebroRisks: allFalse,
    arr: 480_000,
    products: ['Zuora Billing'],
    cseName: 'Sarah Greene',
    ownerName: 'Marcus Cole',
    commentary: 'STATE AND RENEWAL RISK: stable.\nACTION PLAN: explore Revenue.',
    commentaryDaysAgo: 11,
    riskAnalysis: 'Healthy; whitespace in Revenue and Payments.',
    subMetrics: { 'Executive Meeting Count (90d)': 2, 'Projected Billing Utilization (%)': 76 },
    workshops: [{ date: daysAgoIso(50), type: 'Revenue Workshop' }],
    meetings: [{ source: 'calendar', title: 'Revenue discovery', daysAgo: 3 }],
    opps: [
      {
        id: 'OPP-07-UP',
        name: 'Cobalt Revenue Upsell',
        type: 'Upsell',
        stage: 'Stage 4 - Propose',
        stageNum: 4,
        closeDaysAhead: 70,
        acv: 220_000,
        atr: 0,
        forecastMostLikely: 200_000,
        confidence: 'High',
        hedge: 180_000,
        acvDelta: 220_000,
        productLine: 'Zuora Revenue',
        flmNotes: 'Champion engaged; commercial review next week.',
        scNextSteps: 'Commercial deck due Friday.',
      },
    ],
  },

  // 8) Healthy with active upsell
  {
    id: '08',
    sfid: '0010000000000008AAA',
    name: 'Vela Insurance',
    sentiment: 'Green',
    cerebroRisk: 'Medium',
    cerebroRisks: { ...allFalse, shareRisk: true },
    arr: 1_650_000,
    products: ['Zuora Billing'],
    cseName: 'Daniel Kim',
    ownerName: 'Avery Singh',
    commentary: 'STATE AND RENEWAL RISK: stable; product share opportunity.\nACTION PLAN: drive CPQ adoption.',
    commentaryDaysAgo: 9,
    riskAnalysis: 'Sole product share moderate; adjacent product opportunity in CPQ.',
    subMetrics: { 'Executive Meeting Count (90d)': 3, 'Projected Billing Utilization (%)': 82 },
    workshops: [{ date: daysAgoIso(60), type: 'CPQ Discovery' }],
    meetings: [{ source: 'zoom', title: 'CPQ briefing', daysAgo: 6 }],
    opps: [
      {
        id: 'OPP-08-UP',
        name: 'Vela CPQ Upsell',
        type: 'Upsell',
        stage: 'Stage 2 - Discovery',
        stageNum: 2,
        closeDaysAhead: 130,
        acv: 300_000,
        atr: 0,
        forecastMostLikely: 200_000,
        confidence: 'Medium',
        hedge: 150_000,
        acvDelta: 300_000,
        productLine: 'CPQ',
        flmNotes: 'Discovery in flight.',
        scNextSteps: 'Demo CPQ workflow patterns.',
      },
    ],
  },

  // 9) Healthy stable renewal
  {
    id: '09',
    sfid: '0010000000000009AAA',
    name: 'Brookline Education',
    sentiment: 'Green',
    cerebroRisk: 'Low',
    cerebroRisks: allFalse,
    arr: 410_000,
    products: ['Zuora Billing'],
    cseName: 'Sarah Greene',
    ownerName: 'Lara Chen',
    commentary: 'STATE AND RENEWAL RISK: stable, low-touch.',
    commentaryDaysAgo: 14,
    riskAnalysis: 'Quiet, healthy customer. No movement expected.',
    subMetrics: { 'Executive Meeting Count (90d)': 1, 'Projected Billing Utilization (%)': 65 },
    workshops: [{ date: daysAgoIso(120) }],
    meetings: [{ source: 'calendar', title: 'CSM check-in', daysAgo: 17 }],
    opps: [
      {
        id: 'OPP-09-REN',
        name: 'Brookline FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 5 - Negotiate',
        stageNum: 5,
        closeDaysAhead: 200,
        acv: 410_000,
        atr: 410_000,
        forecastMostLikely: 410_000,
        confidence: 'Confirmed',
        hedge: 410_000,
        acvDelta: 0,
        productLine: 'Zuora Billing',
        flmNotes: 'Flat. Closed-won expected.',
        scNextSteps: 'Awaiting countersignature.',
      },
    ],
  },

  // 10) Healthy stable renewal
  {
    id: '10',
    sfid: '0010000000000010AAA',
    name: 'Sterling Aerospace',
    sentiment: 'Green',
    cerebroRisk: 'Low',
    cerebroRisks: allFalse,
    arr: 2_100_000,
    products: ['Zuora Billing', 'Zuora Revenue', 'Zuora Payments'],
    cseName: 'Daniel Kim',
    ownerName: 'Avery Singh',
    commentary: 'STATE AND RENEWAL RISK: anchor account; stable.\nACTION PLAN: maintain.',
    commentaryDaysAgo: 7,
    riskAnalysis: 'Strategic anchor account with broad suite adoption.',
    subMetrics: { 'Executive Meeting Count (90d)': 5, 'Projected Billing Utilization (%)': 91 },
    workshops: [{ date: daysAgoIso(15) }],
    meetings: [{ source: 'zoom', title: 'Quarterly Exec Review', daysAgo: 6 }],
    opps: [
      {
        id: 'OPP-10-REN',
        name: 'Sterling FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 4 - Propose',
        stageNum: 4,
        closeDaysAhead: 250,
        acv: 2_100_000,
        atr: 2_100_000,
        forecastMostLikely: 2_200_000,
        confidence: 'High',
        hedge: 2_100_000,
        acvDelta: 100_000,
        productLine: 'Zuora Billing',
        flmNotes: 'Multi-year extension under review.',
        scNextSteps: 'Joint roadmap session next month.',
      },
    ],
  },

  // 11) Edge: Green sentiment but Cerebro High (conflict)
  {
    id: '11',
    sfid: '0010000000000011AAA',
    name: 'Rivian Subscription Services',
    sentiment: 'Green',
    cerebroRisk: 'High',
    cerebroRisks: { ...allFalse, utilizationRisk: true, suiteRisk: true },
    arr: 540_000,
    products: ['Zuora Billing'],
    cseName: 'Priya Patel',
    ownerName: 'Lara Chen',
    commentary: 'STATE AND RENEWAL RISK: CSE optimistic; Cerebro flags utilization.',
    commentaryDaysAgo: 10,
    riskAnalysis: 'AI flags utilization and suite gaps despite green CSE sentiment. Investigate disconnect.',
    subMetrics: { 'Executive Meeting Count (90d)': 2, 'Projected Billing Utilization (%)': 38 },
    workshops: [{ date: daysAgoIso(70) }],
    opps: [
      {
        id: 'OPP-11-REN',
        name: 'Rivian FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 3 - Validate',
        stageNum: 3,
        closeDaysAhead: 95,
        acv: 540_000,
        atr: 540_000,
        forecastMostLikely: 540_000,
        confidence: 'Medium',
        hedge: 500_000,
        acvDelta: 0,
        productLine: 'Zuora Billing',
        flmNotes: 'CSE green; AI flags utilization. Need usage deep-dive.',
        scNextSteps: 'Pull usage telemetry; review with customer ops.',
      },
    ],
  },

  // 12) Edge: Cerebro Risk Category missing → exercises fallback
  {
    id: '12',
    sfid: '0010000000000012AAA',
    name: 'Pinecrest Publishing',
    sentiment: 'Yellow',
    cerebroRisk: null,
    cerebroRisks: { ...allFalse, engagementRisk: true, shareRisk: true },
    arr: 320_000,
    products: ['Zuora Billing'],
    cseName: 'Sarah Greene',
    ownerName: 'Marcus Cole',
    commentary: 'STATE AND RENEWAL RISK: low engagement.',
    commentaryDaysAgo: 25,
    riskAnalysis: null,
    subMetrics: { 'Executive Meeting Count (90d)': 1, 'Projected Billing Utilization (%)': 55 },
    workshops: [],
    opps: [
      {
        id: 'OPP-12-REN',
        name: 'Pinecrest FY26 Renewal',
        type: 'Renewal',
        stage: 'Stage 2 - Discovery',
        stageNum: 2,
        closeDaysAhead: 80,
        acv: 320_000,
        atr: 320_000,
        forecastMostLikely: 320_000,
        confidence: 'Low',
        hedge: 280_000,
        acvDelta: 0,
        productLine: 'Zuora Billing',
        flmNotes: '',
        scNextSteps: '',
      },
    ],
  },
];

export function getMockData(): {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
} {
  const accounts: CanonicalAccount[] = [];
  const opportunities: CanonicalOpportunity[] = [];
  for (const b of builds) {
    const { account, opportunities: opps } = buildAccount(b);
    accounts.push(account);
    opportunities.push(...opps);
  }
  return { accounts, opportunities };
}

// For week-over-week, produce a "prior" snapshot with simulated changes so two refreshes
// against mocks yield non-empty WoW.
export function getMockDataPrior(): {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
} {
  const { accounts, opportunities } = getMockData();
  // Mutate the prior version so current vs prior diff is non-empty.
  const prior = {
    accounts: accounts.map((a) => ({ ...a, workshops: [...a.workshops], cerebroRisks: { ...a.cerebroRisks } })),
    opportunities: opportunities.map((o) => ({ ...o })),
  };

  // Helios (02): prior risk High → currently Critical
  const helios = prior.accounts.find((a) => a.accountId === '0010000000000002AAA');
  if (helios) helios.cerebroRiskCategory = 'High';

  // Bridgewater (03): prior sentiment Yellow → currently Red
  const bw = prior.accounts.find((a) => a.accountId === '0010000000000003AAA');
  if (bw) bw.cseSentiment = 'Yellow';

  // Kestrel (04): prior had no recent workshop; current has one → workshop added this week
  const kestrel = prior.accounts.find((a) => a.accountId === '0010000000000004AAA');
  if (kestrel) kestrel.workshops = [];

  // Lumen Zephr (06): prior stage Stage 2; current Stage 3
  const lumenZephr = prior.opportunities.find((o) => o.opportunityId === 'OPP-06-UP');
  if (lumenZephr) {
    lumenZephr.stageName = 'Stage 2 - Discovery';
    lumenZephr.stageNum = 2;
    lumenZephr.forecastMostLikely = 150_000;
  }

  // Northwind (01): prior had no churn notice date
  const nw = prior.opportunities.find((o) => o.opportunityId === 'OPP-01-CHURN');
  if (nw) {
    nw.fullChurnNotificationToOwnerDate = null;
    nw.fullChurnFinalEmailSentDate = null;
  }

  // Pinecrest (12): prior had cerebroRisks.engagementRisk false → currently true
  const pine = prior.accounts.find((a) => a.accountId === '0010000000000012AAA');
  if (pine) pine.cerebroRisks = { ...pine.cerebroRisks, engagementRisk: false };

  return prior;
}
