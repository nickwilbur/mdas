/**
 * Plain-language context for leadership dashboard cards — signals, jargon, and manager actions.
 */

export interface TermDefinition {
  /** Primary phrase to match in signal / interpretation text */
  term: string;
  /** Alternate spellings (e.g. team-aware vs team_aware) */
  aliases?: string[];
  definition: string;
}

export interface DashboardCardContext {
  id: string;
  title: string;
  /** One-sentence plain English summary (hover) */
  overview: string;
  /** What the numbers / facts in the Signal column mean */
  whatTheSignalMeans: string;
  /** What the Leadership Interpretation sentence means */
  whatTheInterpretationMeans: string;
  /** When report wording ≠ what MDAS automates today */
  measurementNote?: string;
  managerActions: string[];
  dataSource: string;
  relatedLinks?: { label: string; href: string }[];
  terms: TermDefinition[];
}

/** Cross-cutting terms that may appear on multiple cards */
export const GLOBAL_TERMS: TermDefinition[] = [
  {
    term: 'CTA',
    aliases: ['CTAs'],
    definition:
      'Call-to-action play — a ranked save, engagement, or wind-down motion generated from account risk signals. Tracked on the CTA board and in expand3_cta_log.jsonl.',
  },
  {
    term: 'ATR at risk',
    aliases: ['ATR'],
    definition:
      'Annualized contract value tied to open renewal opportunities flagged as at risk in the current CTA scan.',
  },
  {
    term: 'dark-account',
    aliases: ['dark account', 'dark-account play', 'dark-account plays'],
    definition:
      'CTA play when weighted engagement signals cross the dark-account threshold — primarily stale SFDC commentary, no workshop in 365d, no Glean-indexed meetings, and Cerebro flags. Engagio SFDC fields can contribute in the engine but are not part of CSE review today.',
  },
  {
    term: 'team_aware',
    aliases: ['team-aware', 'team aware', 'Team Aware'],
    definition:
      'CTA scan flag set when SFDC CSE sentiment commentary contains active-plan language (e.g. "action plan", "QBR scheduled"). MDAS does not read Slack replies for this today.',
  },
  {
    term: 'save motion',
    aliases: ['save motions', 'open save motion'],
    definition:
      'An open CTA aimed at retaining revenue on an upcoming renewal (as opposed to confirmed churn retro or managed wind-down).',
  },
  {
    term: 'check-back',
    aliases: ['check back', 'check_back_date'],
    definition:
      'Generated CTA date (check_back_date, usually ~7 days before deadline) when the pod should report progress on /ctas.',
  },
];

const HEALTH_AREA_CONTEXT: Record<string, DashboardCardContext> = {
  'near-term renewal risk': {
    id: 'near-term-renewal',
    title: 'Near-Term Renewal Risk (≤90 days)',
    overview:
      'Accounts renewing inside 90 days with elevated save risk — calendar urgency drives exec intervention.',
    whatTheSignalMeans:
      'Lists the highest-urgency renewal in the book: account name, renewal date, dollars at risk, and CSE sentiment color. Red sentiment means the pod has flagged serious concern.',
    whatTheInterpretationMeans:
      'Leadership should treat this as a war-room item: AE + CSE + exec sponsor aligned on a documented save plan before the renewal date.',
    managerActions: [
      'Convene AE + CSE within 48 hours for any Red account renewing ≤30 days.',
      'Confirm exec sponsor and logged customer touch in Glean/SFDC.',
      'Close or advance the linked CTA before renewal date.',
    ],
    dataSource: 'CTA scan + /renewals prospective buckets + SFDC renewal opps',
    relatedLinks: [
      { label: 'CTA board', href: '/ctas' },
      { label: 'Renewals view', href: '/renewals' },
    ],
    terms: [
      {
        term: 'CSE sentiment',
        definition: 'Pod-assigned Red/Yellow/Green health label in Salesforce — Red triggers save motions.',
      },
    ],
  },
  'dark / disengaged accounts': {
    id: 'dark-accounts',
    title: 'Dark / Disengaged Accounts',
    overview:
      'How many save plays are driven by thin customer engagement rather than explicit churn signals.',
    whatTheSignalMeans:
      'The fraction of CTAs classified as dark_account plays — typically no workshop in 365d, stale CSE commentary, and/or no recent customer meetings in Glean, despite an upcoming renewal.',
    whatTheInterpretationMeans:
      'Risks are identified early, but customer touch is lagging. Engagement plays must convert to logged workshops and updated SFDC commentary before renewal windows narrow.',
    managerActions: [
      'Review dark-account CTAs weekly; assign owner and first outreach date.',
      'Require logged workshop or QBR within 30 days for reds renewing <6 months.',
    ],
    dataSource:
      'CTA engine dark-account detector — SFDC workshops & commentary, Glean MCP meetings when refreshed, Cerebro engagement risk (Engagio SFDC fields are engine-only, not CSE-reviewed)',
    relatedLinks: [{ label: 'CTA board (dark_account filter)', href: '/ctas' }],
    terms: GLOBAL_TERMS.filter((t) => t.term.includes('dark')),
  },
  'open save motion execution': {
    id: 'open-save-execution',
    title: 'Open Save Motion Execution',
    overview: 'Whether identified save plays are being closed or still piling up open.',
    whatTheSignalMeans:
      'Open vs closed CTA count and the percentage still active. High open % means identification is outpacing closure.',
    whatTheInterpretationMeans:
      'Managers need a weekly top-10 review cadence so open plays get triaged, owned, and moved to done or in_progress on /ctas.',
    managerActions: [
      'Run 30-minute Monday top-10 CTA review on /ctas.',
      'Stack-rank by priority score and ATR at risk.',
      'Close or reassign stale plays older than two check-back cycles.',
    ],
    dataSource: 'expand3_cta_log.jsonl status field (open / done)',
    relatedLinks: [{ label: 'CTA board', href: '/ctas' }],
    terms: [],
  },
  'atr at risk visibility': {
    id: 'atr-visibility',
    title: 'ATR at Risk Visibility',
    overview: 'Leadership can see total dollars exposed and tie each play to a renewal opportunity.',
    whatTheSignalMeans:
      'Aggregate open ATR from ranked CTAs — directional until SFDC/Clari reconciliation completes.',
    whatTheInterpretationMeans:
      'This area is healthy when dollars are visible and stack-ranked; use priority score for where to focus saves.',
    managerActions: [
      'Use ATR totals in weekly staff meeting — not just CTA count.',
      'Spot-check top 5 accounts against SFDC renewal amounts.',
    ],
    dataSource: 'CTA log atr_at_risk_usd + renewal opp linkage in MDAS',
    relatedLinks: [{ label: 'Renewals view', href: '/renewals' }],
    terms: [],
  },
  'forward-quarter portfolio view': {
    id: 'forward-quarter',
    title: 'Forward-Quarter Portfolio View',
    overview: 'Whether managers can steer 6–8 quarters out using prospective renewal buckets.',
    whatTheSignalMeans:
      'MDAS exposes 8-quarter prospective renewal pipeline — each CTA can link to a named opp.',
    whatTheInterpretationMeans:
      'Tooling is in place; value depends on managers reviewing /renewals weekly during staff meetings.',
    managerActions: [
      'Add forward-quarter review to monthly leadership readout.',
      'Link new CTAs to the correct renewal opportunity.',
    ],
    dataSource: 'MDAS /renewals prospective buckets',
    relatedLinks: [{ label: 'Renewals view', href: '/renewals' }],
    terms: [],
  },
  'churn & downsell exposure': {
    id: 'churn-downsell',
    title: 'Churn & Downsell Exposure',
    overview: 'Named wind-down and suite/utilization risks where harvest may be the right outcome.',
    whatTheSignalMeans:
      'Count of managed_wind_down plays and accounts flagged for downsell or suite reduction.',
    whatTheInterpretationMeans:
      'Downsell paths are visible — leadership should confirm save vs harvest with AEs rather than defaulting to save motions.',
    managerActions: [
      'Dual-track: save plan for recoverable accounts; clean harvest plan for wind-downs.',
      'Align with AE on confirmed churn vs managed exit.',
    ],
    dataSource: 'CTA play_type managed_wind_down + SFDC commentary',
    relatedLinks: [{ label: 'CTA board', href: '/ctas' }],
    terms: [
      {
        term: 'managed wind-down',
        aliases: ['wind-down'],
        definition:
          'Customer exit or reduction is documented in SFDC commentary — CTA tracks orderly harvest, not a save play.',
      },
    ],
  },
  'customer engagement quality': {
    id: 'engagement-quality',
    title: 'Customer Engagement Quality',
    overview:
      'Whether near-term renewal accounts show thin customer touch in the signals CSEs actually use — SFDC workshops, sentiment commentary, and Glean-indexed meetings.',
    whatTheSignalMeans:
      'Multiple red accounts show no recent SFDC workshops, stale CSE sentiment commentary, and thin indexed customer meetings ahead of renewal.',
    whatTheInterpretationMeans:
      'Customer touch is lagging behind identified risk — pods need logged workshops and updated commentary before renewal windows narrow.',
    measurementNote:
      'Engagio SFDC fields can appear in CTA engine drivers but are not part of the CSE workflow today. Validate field freshness before using in leadership metrics.',
    managerActions: [
      'Review red renewals <12 months with no workshop logged in 6+ months.',
      'Update CSE sentiment commentary after outreach — that is what drives team_aware on the next scan.',
      'Optional: spot-check Engagio field freshness on a sample account before adding to staff metrics.',
    ],
    dataSource:
      'CSE-facing: SFDC workshops, CSE sentiment commentary, Glean MCP recentMeetings, Cerebro engagement flags. Engine-only: Engagio SFDC fields',
    terms: [
      {
        term: 'Engagio minutes below threshold',
        aliases: [
          'Engagio minutes',
          'Engagio',
          'Engagio minutes below threshold on multiple reds',
        ],
        definition:
          'Language from the weekly brief, not a CSE-reviewed metric. Demandbase Engagio minutes sync to SFDC and can feed MDAS dark-account detection — but pods do not use marketing engagement scores in save motions today. Validate field freshness before treating as leadership signal.',
      },
      {
        term: 'sparse workshops',
        aliases: ['no workshop in 365d', 'no workshop in 12 months'],
        definition:
          'No customer workshop logged in SFDC within the lookback window — a primary dark-account and engagement signal CSEs and managers do track.',
      },
      {
        term: 'Activity signals say "quiet"',
        aliases: ['Activity signals say “quiet”'],
        definition:
          'Composite read: thin workshops, stale commentary, and/or few indexed customer meetings — the engagement picture CSEs work from, not marketing scores.',
      },
    ],
  },
  'executive sponsor coverage': {
    id: 'exec-sponsor',
    title: 'Executive Sponsor Coverage',
    overview:
      'Whether top open risks show exec- or QBR-level customer motion in the reporting window.',
    whatTheSignalMeans:
      'Weekly leadership assessment: few of the highest-ATR open CTAs had logged exec sponsor or QBR activity in Glean/Cerebro this period.',
    whatTheInterpretationMeans:
      'Escalation paths exist in the playbook, but sponsor-level engagement is not showing up on the top risks this week.',
    measurementNote:
      'Not an automated MDAS dashboard metric — based on manual review of Glean-indexed activity and Cerebro exec-meeting sub-metrics.',
    managerActions: [
      'Name an exec sponsor on top-10 CTAs in weekly review.',
      'Log QBR or exec touch; confirm it appears after the next MDAS refresh.',
    ],
    dataSource: 'Manual weekly review; Cerebro crExecutiveMeetingCount; Glean MCP meetings when refreshed',
    terms: [
      {
        term: 'QBR',
        definition: 'Quarterly business review — executive-level customer meeting documenting strategic alignment.',
      },
    ],
  },
  'upsell & expansion motion': {
    id: 'upsell-expansion',
    title: 'Upsell & Expansion Motion',
    overview: 'Balance between save-the-renewal work and proactive expansion pipeline.',
    whatTheSignalMeans:
      'Upsell scoring exists on account views, but this scan cycle produced no dedicated expansion CTAs.',
    whatTheInterpretationMeans:
      'Renewal-save dominates the motion mix this week — expansion is not the operational focus (Partial status).',
    managerActions: [
      'After save backlog stabilizes, nominate 2–3 expansion candidates per pod.',
      'Use upsell scores in monthly planning, not weekly save triage.',
    ],
    dataSource: 'Account view upsell scoring; CTA play_type mix',
    terms: [
      {
        term: 'Partial',
        definition: 'Capability exists but execution or focus is incomplete this reporting period — not Red or Green.',
      },
    ],
  },
  'team accountability': {
    id: 'team-accountability',
    title: 'Team Accountability',
    overview:
      'How many CTAs show evidence the pod has engaged with the risk (team_aware) vs open plays still awaiting manager/pod follow-through.',
    whatTheSignalMeans:
      '3 of 31 CTAs have team_aware=true on the Jun 25 scan. That flag is set at scan time when SFDC CSE sentiment commentary matches active-plan phrases — not from Slack thread monitoring.',
    whatTheInterpretationMeans:
      '"Broadcast but not owned in-channel" is leadership shorthand: risks are ranked on the CTA board and Slack copy can be drafted, but most plays lack commentary evidence the pod has engaged. Manager follow-through gap: weekly CTA review and progress updates on /ctas are not yet habitual.',
    measurementNote:
      'MDAS does not auto-post CTAs to Slack (send is manual via /admin/slack, preview + confirm). MDAS does not measure Slack thread replies. "Slack threads not acknowledged" in the report reflects the desired operating model, not a live Slack integration.',
    managerActions: [
      'Run weekly 30-min top-10 CTA review on /ctas; update status and progress notes.',
      'When posting manually to Slack, update SFDC commentary so the next scan can reflect engagement.',
      'Target ≥50% open CTAs team_aware (commentary-based) or done — per this week\'s leadership ask.',
    ],
    dataSource: 'expand3_cta_log.jsonl team_aware (from CTA engine rules on SFDC commentary)',
    relatedLinks: [
      { label: 'CTA board', href: '/ctas' },
      { label: 'Slack mappings (manual send)', href: '/admin/slack' },
    ],
    terms: [
      {
        term: 'team_aware',
        aliases: ['team-aware', 'team aware'],
        definition:
          'Scan-time flag when SFDC CSE sentiment commentary contains active-plan language. Not set by Slack replies. Shown as "Team Aware" badge on /ctas.',
      },
      {
        term: 'Slack threads not acknowledged',
        aliases: ['not acknowledged', 'most Slack threads not acknowledged'],
        definition:
          'Report shorthand for low team_aware rate. MDAS does not ingest Slack thread replies today — use team_aware and CTA progress fields as the measurable proxy.',
      },
      {
        term: 'risk signals are broadcast but not owned in-channel',
        aliases: ['broadcast but not owned', 'not owned in-channel'],
        definition:
          'Leadership read: CTAs and risk rankings are visible in MDAS, but pods have not documented ownership (SFDC commentary / CTA progress). Slack posting is optional and manual — not automated broadcast.',
      },
      {
        term: 'manager follow-through gap',
        aliases: ['follow-through gap'],
        definition:
          'Managers are not yet running consistent weekly CTA triage — reviewing open plays, updating status, and ensuring pods document action in SFDC commentary.',
      },
    ],
  },
};

const EXEC_SUMMARY_CONTEXT: Record<string, Pick<DashboardCardContext, 'overview' | 'terms'>> = {
  'atr at risk': {
    overview: 'Dollar exposure from open save motions — directional until SFDC/Clari reconciliation.',
    terms: GLOBAL_TERMS.filter((t) => t.term === 'ATR at risk' || t.term === 'CTA'),
  },
  'near-term renewals': {
    overview: 'Calendar-urgent renewals requiring intervention this week.',
    terms: [],
  },
  'engagement gap': {
    overview:
      'Dark-account plays (thin engagement) plus low team_aware count — risks visible on /ctas but SFDC commentary rarely shows an active plan.',
    terms: GLOBAL_TERMS.filter((t) =>
      ['dark-account', 'team_aware', 'CTA'].includes(t.term),
    ),
  },
  'forward portfolio': {
    overview: '8-quarter renewal visibility for long-range steering.',
    terms: [],
  },
  'retention measurement': {
    overview: 'GRR/churn views exist but week-over-week trend vs board goal is not yet validated.',
    terms: [],
  },
  posture: {
    overview: 'Overall Yellow = risks ranked and visible, but closure and touch cadence lag identification.',
    terms: [],
  },
};

const ATTENTION_CONTEXT: Record<string, Pick<DashboardCardContext, 'overview' | 'terms'>> = {
  'antylia july 5 renewal': {
    overview: 'Highest calendar urgency — renews in 9 days with Red sentiment and no recent workshop.',
    terms: GLOBAL_TERMS.filter((t) => t.term === 'dark-account'),
  },
  'cta closure cadence': {
    overview:
      '26 open plays with ~$3.7M exposed — needs weekly manager triage on /ctas (status, owners, progress notes).',
    terms: GLOBAL_TERMS.filter((t) => ['team_aware', 'CTA', 'check-back'].includes(t.term)),
  },
  'retention metric confidence': {
    overview: 'Board 10% ATR retention goal needs a trusted baseline from SFDC/Clari spot-check.',
    terms: [],
  },
};

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*\*/g, '')
    .replace(/[`']/g, '')
    .trim();
}

function lookupByPrefix<T>(map: Record<string, T>, key: string): T | null {
  const normalized = normalizeKey(key);
  if (map[normalized]) return map[normalized];
  for (const [k, v] of Object.entries(map)) {
    if (normalized.includes(k) || k.includes(normalized)) return v;
  }
  return null;
}

export function getHealthAreaContext(area: string): DashboardCardContext | null {
  return lookupByPrefix(HEALTH_AREA_CONTEXT, area);
}

export function getExecutiveSummaryContext(label: string): Pick<DashboardCardContext, 'overview' | 'terms'> | null {
  return lookupByPrefix(EXEC_SUMMARY_CONTEXT, label);
}

export function getAttentionContext(item: string): Pick<DashboardCardContext, 'overview' | 'terms'> | null {
  return lookupByPrefix(ATTENTION_CONTEXT, item);
}

/** All term definitions applicable to a card (card-specific + global, deduped) */
export function collectTerms(
  ...sources: (TermDefinition[] | undefined)[]
): TermDefinition[] {
  const seen = new Set<string>();
  const out: TermDefinition[] = [];
  for (const list of [GLOBAL_TERMS, ...sources]) {
    if (!list) continue;
    for (const t of list) {
      const key = normalizeKey(t.term);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out.sort((a, b) => b.term.length - a.term.length);
}

export interface TextSegment {
  text: string;
  term?: TermDefinition;
}

/** Split text into plain segments and matched glossary terms (longest match first). */
export function segmentTextWithTerms(text: string, terms: TermDefinition[]): TextSegment[] {
  if (!text || terms.length === 0) return [{ text }];

  const patterns = terms.flatMap((t) => {
    const phrases = [t.term, ...(t.aliases ?? [])];
    return phrases.map((p) => ({ phrase: p, term: t }));
  });
  patterns.sort((a, b) => b.phrase.length - a.phrase.length);

  const segments: TextSegment[] = [];
  let i = 0;
  while (i < text.length) {
    let matched: { phrase: string; term: TermDefinition } | null = null;
    for (const p of patterns) {
      const slice = text.slice(i, i + p.phrase.length);
      if (slice.toLowerCase() === p.phrase.toLowerCase()) {
        matched = p;
        break;
      }
    }
    if (matched) {
      segments.push({ text: text.slice(i, i + matched.phrase.length), term: matched.term });
      i += matched.phrase.length;
    } else {
      let end = i + 1;
      while (end < text.length) {
        let nextMatch = false;
        for (const p of patterns) {
          if (text.slice(end, end + p.phrase.length).toLowerCase() === p.phrase.toLowerCase()) {
            nextMatch = true;
            break;
          }
        }
        if (nextMatch) break;
        end++;
      }
      segments.push({ text: text.slice(i, end) });
      i = end;
    }
  }
  return segments;
}
