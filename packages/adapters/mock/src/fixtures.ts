import type {
  CanonicalAccount,
  CanonicalOpportunity,
  CSESentiment,
  CerebroRiskCategory,
  CerebroRisks,
  SourceLink,
} from '@mdas/canonical';

const FRANCHISE = 'Expand 3';

// Real Expand 3 accounts from Glean (FY27 - Expand 3 Account Changes spreadsheet)
const REAL_EXPAND_3_ACCOUNTS = [
  { sfid: '0017000001TL8uwAAD', name: 'Adweek, LLC', products: ['Zephr'] },
  { sfid: '0017000000nsQPHAA2', name: 'WEHCO Media, Inc', products: ['Zephr'] },
  { sfid: '0017000000j2jlwAAA', name: 'Quotit Corporation', products: ['Billing'] },
  { sfid: '0017000000uJ9uSAAS', name: 'Teladoc Health, Inc.', products: ['RevPro'] },
  { sfid: '0017000000YruVLAAZ', name: 'Acquia, Inc.', products: ['Billing'] },
  { sfid: '0017000001SDBrqAAH', name: 'IBM Corporation', products: ['Billing'] },
  { sfid: '0017000000PnYcNAAV', name: 'Riverbed Technology', products: ['RevPro'] },
  { sfid: '0017000000nsQV2AAM', name: 'Rimini Street, Inc.', products: ['RevPro'] },
  { sfid: '0017000000koAphAAE', name: 'Prezi', products: ['Billing'] },
  { sfid: '00170000018Ip9UAAS', name: 'Automation Anywhere Inc.', products: ['RevPro'] },
  { sfid: '0017000000SxbSWAAZ', name: 'Tobii Dynavox', products: ['Billing'] },
  { sfid: '0017000000zWBGNAA4', name: 'GoAnimate, Inc. (Vyond)', products: ['Billing'] },
];

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

const builds: Build[] = REAL_EXPAND_3_ACCOUNTS.map((acc, i) => ({
  id: String(i + 1).padStart(2, '0'),
  sfid: acc.sfid,
  name: acc.name,
  sentiment: i === 0 ? 'Confirmed Churn' : i === 1 ? 'Red' : 'Green',
  cerebroRisk: i === 0 ? 'Critical' : i === 1 ? 'High' : 'Low',
  cerebroRisks: i === 0 ? { ...allFalse, utilizationRisk: true, engagementRisk: true, shareRisk: true, pricingRisk: true } : allFalse,
  arr: 500_000 + i * 100_000,
  products: acc.products,
  cseName: ['Christopher Franklin-Hollier', 'Sneha Stephen', 'Shwetha Ravindran', 'Kiran Rajan', 'Mahalakshmi Krishnan', 'Jayaram Iyer'][i % 6],
  ownerName: 'Brandon LaTourelle',
  commentary: i === 0 ? 'STATE AND RENEWAL RISK: Monitoring for potential consolidation risks.\nACTION PLAN: Increase executive engagement; ensure value realization.' : 'Customer engagement stable. Regular quarterly business reviews scheduled.',
  commentaryDaysAgo: 7 + i,
  riskAnalysis: null,
  subMetrics: {},
  workshops: i % 2 === 0 ? [{ date: daysAgoIso(90) }] : [],
  meetings: [{ source: 'zoom', title: 'Quarterly Business Review', daysAgo: 14 + i * 7 }],
  isConfirmedChurn: i === 0,
  churnReason: i === 0 ? 'Competitive Pressure' : undefined,
  churnReasonSummary: i === 0 ? 'Considering competitor due to pricing concerns.' : undefined,
  churnDate: i === 0 ? daysAheadIso(90).slice(0, 10) : undefined,
  opps: [
    {
      id: `OPP-${i + 1}-RENEWAL`,
      name: `${acc.name} FY27 Renewal`,
      type: 'Renewal',
      stage: i === 0 ? 'Closed Lost' : i === 1 ? 'Negotiation' : 'Qualification',
      stageNum: i === 0 ? 9 : i === 1 ? 6 : 2,
      closeDaysAhead: 90 + i * 30,
      acv: 500_000 + i * 100_000,
      atr: 500_000 + i * 100_000,
      forecastMostLikely: i === 0 ? 0 : 500_000 + i * 100_000,
      confidence: i === 1 ? 'High' : 'Medium',
      hedge: i === 1 ? 50_000 : 0,
      acvDelta: 0,
      knownChurn: i === 0 ? 500_000 + i * 100_000 : 0,
      productLine: acc.products[0],
      flmNotes: '',
      scNextSteps: i === 1 ? 'Schedule executive meeting to discuss renewal terms.' : '',
      salesEngineerName: null,
      fullChurnNotificationToOwnerDate: i === 0 ? daysAgoIso(14).slice(0, 10) : null,
      fullChurnFinalEmailSentDate: i === 0 ? daysAgoIso(7).slice(0, 10) : null,
      churnDownsellReason: i === 0 ? 'Pricing' : null,
    },
  ],
}));

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
