import type { AccountView, CanonicalOpportunity, ChangeEvent } from '@mdas/canonical';
import { fiscalQuarterFromDate, fiscalQuarterLabel } from './fiscal.js';

// PR-C3 — re-export Clari CSV + dark-account helpers from the public
// surface of @mdas/forecast-generator.
export { generateClariCsv, findDarkAccounts } from './clari-csv.js';
export type { ClariCsvOptions, DarkAccount } from './clari-csv.js';

export interface ForecastInput {
  views: AccountView[];
  changeEvents: ChangeEvent[];
  /** ISO YYYY-MM-DD; the quarter containing this date is "current". */
  asOfDate: string;
  /** Free-text — included for compatibility with the old API. */
  audience?: string;
  /**
   * Optional managerial input. When provided, the generator computes
   * Gap to Plan; otherwise a `[fill in]` placeholder is emitted so
   * leadership knows the field is intentionally blank.
   */
  plan?: { currentQuarterUSD?: number; nextQuarterUSD?: number };
}

const fmtUSD = (n: number) =>
  n === 0 ? '$0' : `$${Math.round(n).toLocaleString('en-US')}`;

const fmtSignedUSD = (n: number) => {
  if (n === 0) return '$0';
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  return n > 0 ? `+$${abs}` : `-$${abs}`;
};

interface QuarterBucket {
  label: string;
  key: string;
  /**
   * Opportunity rows whose closeDate falls in this quarter, paired with
   * their parent account for downstream lookups.
   */
  rows: { view: AccountView; opp: CanonicalOpportunity }[];
}

function bucketByQuarter(
  views: AccountView[],
  asOfDate: string,
): { current: QuarterBucket; next: QuarterBucket } {
  const todayFq = fiscalQuarterFromDate(asOfDate);
  if (!todayFq) {
    // Should not happen — asOfDate is a controlled input — but emit
    // empty buckets rather than crash.
    return {
      current: { label: 'Current Quarter', key: '', rows: [] },
      next: { label: 'Next Quarter', key: '', rows: [] },
    };
  }
  // Anchor "next quarter" by adding ~3 months to asOfDate. We use UTC
  // arithmetic to avoid DST drift around February (FY boundary).
  const d = new Date(`${asOfDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 3);
  const nextFq = fiscalQuarterFromDate(d.toISOString());

  const current: QuarterBucket = {
    label: fiscalQuarterLabel(todayFq.key),
    key: todayFq.key,
    rows: [],
  };
  const next: QuarterBucket = {
    label: nextFq ? fiscalQuarterLabel(nextFq.key) : 'Next Quarter',
    key: nextFq?.key ?? '',
    rows: [],
  };

  for (const v of views) {
    for (const o of v.opportunities) {
      const fq = fiscalQuarterFromDate(o.closeDate);
      if (!fq) continue;
      if (fq.key === current.key) current.rows.push({ view: v, opp: o });
      else if (fq.key === next.key) next.rows.push({ view: v, opp: o });
    }
  }
  return { current, next };
}

/**
 * Net forecast value for an opportunity.
 *  - Renewals / Churn: forecastMostLikely is what we EXPECT to keep,
 *    so the loss = ATR - forecastMostLikely (or knownChurnUSD if set).
 *  - For this churn-call view we surface the LOSS as a positive
 *    dollar number ("$X churn risk").
 */
function churnAmount(opp: CanonicalOpportunity): number {
  if (opp.knownChurnUSD && opp.knownChurnUSD > 0) return opp.knownChurnUSD;
  const atr = opp.availableToRenewUSD ?? 0;
  const ml = opp.forecastMostLikelyOverride ?? opp.forecastMostLikely ?? atr;
  return Math.max(0, atr - ml);
}

/** "Flash" = most-likely churn for the quarter (sum of churnAmount). */
function flashChurn(rows: QuarterBucket['rows']): number {
  return rows.reduce((s, r) => s + churnAmount(r.opp), 0);
}

/**
 * "Total Risk / Baseline" = full ATR exposed across confirmed + saveable
 * accounts in the quarter (worst case, before saves).
 */
function totalRisk(rows: QuarterBucket['rows']): number {
  return rows
    .filter(
      (r) =>
        r.view.bucket === 'Confirmed Churn' ||
        r.view.bucket === 'Saveable Risk',
    )
    .reduce((s, r) => s + (r.opp.availableToRenewUSD ?? 0), 0);
}

/** "Hedge" = sum of forecastHedgeUSD (upside / cushion). */
function hedge(rows: QuarterBucket['rows']): number {
  return rows.reduce((s, r) => s + (r.opp.forecastHedgeUSD ?? 0), 0);
}

/** Map account → CSE-set color band. Centralized so red/yellow/green
 *  semantics stay identical across both quarter sections. */
function colorBand(view: AccountView): 'red' | 'yellow' | 'green' {
  // Confirmed Churn or Critical/High risk + Red sentiment → red.
  // Sentiment Yellow or Medium risk → yellow.
  // Otherwise (Green sentiment, Low risk, no signal) → green.
  if (
    view.bucket === 'Confirmed Churn' ||
    view.risk.level === 'Critical' ||
    view.risk.level === 'High' ||
    view.account.cseSentiment === 'Red'
  ) {
    return 'red';
  }
  if (view.risk.level === 'Medium' || view.account.cseSentiment === 'Yellow') {
    return 'yellow';
  }
  return 'green';
}

/**
 * Pull a one-line "what's needed to secure" summary from the data the
 * CSE already captured. Order of preference:
 *   1. opp.scNextSteps (most actionable)
 *   2. account.churnReasonSummary (for confirmed churn)
 *   3. risk rationale
 *   4. literal "[fill in next step]" placeholder so the manager edits
 */
function whatIsNeeded(view: AccountView, opp: CanonicalOpportunity): string {
  const next = opp.scNextSteps?.split('\n')[0]?.trim();
  if (next) return next.slice(0, 160);
  const churn = view.account.churnReasonSummary?.trim();
  if (view.bucket === 'Confirmed Churn' && churn) return churn.slice(0, 160);
  const rationale = view.risk.rationale?.trim();
  if (rationale) return rationale.slice(0, 160);
  return '[fill in next step]';
}

/**
 * Top N saveable / red accounts in the quarter ordered by dollar
 * exposure. Returns one row per account (de-duplicated when an account
 * has multiple opps in the same quarter, taking the largest).
 */
function topAccountsToCloseGap(
  rows: QuarterBucket['rows'],
  band: 'red' | 'yellow' | 'green',
  limit = 5,
): { view: AccountView; opp: CanonicalOpportunity; usd: number }[] {
  const seen = new Map<
    string,
    { view: AccountView; opp: CanonicalOpportunity; usd: number }
  >();
  for (const r of rows) {
    if (colorBand(r.view) !== band) continue;
    const usd = r.opp.acv ?? 0;
    if (usd <= 0) continue;
    const prev = seen.get(r.view.account.accountId);
    if (!prev || usd > prev.usd) {
      seen.set(r.view.account.accountId, { view: r.view, opp: r.opp, usd });
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.usd - a.usd)
    .slice(0, limit);
}

/**
 * Week-over-week changes scoped to the quarter's accounts. Risk and
 * sentiment movements are translated into +/- per template:
 *   '+' = improvement (risk down, sentiment up, churn rescinded)
 *   '-' = regression (risk up, new churn notice, sentiment down)
 */
interface WowSummary {
  accountName: string;
  sign: '+' | '-';
  detail: string;
}

const RISK_RANK: Record<string, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};
const SENT_RANK: Record<string, number> = {
  Green: 3,
  Yellow: 2,
  Red: 1,
  'Confirmed Churn': 0,
};

function wowChanges(
  rows: QuarterBucket['rows'],
  events: ChangeEvent[],
): WowSummary[] {
  const accountIds = new Set(rows.map((r) => r.view.account.accountId));
  const nameById = new Map(
    rows.map((r) => [r.view.account.accountId, r.view.account.accountName]),
  );
  const out = new Map<string, WowSummary>(); // accountId → summary

  for (const e of events) {
    if (!accountIds.has(e.accountId)) continue;
    const name = nameById.get(e.accountId) ?? e.accountId;

    if (e.field === 'cerebroRiskCategory') {
      const oldR = RISK_RANK[String(e.oldValue)] ?? 0;
      const newR = RISK_RANK[String(e.newValue)] ?? 0;
      if (newR === oldR) continue;
      const sign: '+' | '-' = newR < oldR ? '+' : '-';
      out.set(e.accountId, {
        accountName: name,
        sign,
        detail: `Risk ${e.oldValue ?? '∅'} → ${e.newValue ?? '∅'}`,
      });
    } else if (e.field === 'cseSentiment') {
      const oldS = SENT_RANK[String(e.oldValue)] ?? 0;
      const newS = SENT_RANK[String(e.newValue)] ?? 0;
      if (newS === oldS) continue;
      const sign: '+' | '-' = newS > oldS ? '+' : '-';
      out.set(e.accountId, {
        accountName: name,
        sign,
        detail: `Sentiment ${e.oldValue ?? '∅'} → ${e.newValue ?? '∅'}`,
      });
    } else if (e.category === 'churn-notice') {
      out.set(e.accountId, {
        accountName: name,
        sign: '-',
        detail: 'Churn notice submitted',
      });
    }
  }
  // Stable order: regressions first (leadership wants the bad news),
  // then improvements; alphabetical within each.
  return Array.from(out.values()).sort((a, b) => {
    if (a.sign !== b.sign) return a.sign === '-' ? -1 : 1;
    return a.accountName.localeCompare(b.accountName);
  });
}

/**
 * Render one of the two quarter sections. Plain text — no markdown
 * links, bold, or footnotes — because the artifact is pasted into
 * Slack / email as the body of a churn forecast call.
 */
function renderQuarterSection(
  bucket: QuarterBucket,
  events: ChangeEvent[],
  planUSD: number | undefined,
  isCurrent: boolean,
): string[] {
  const lines: string[] = [];
  const flash = flashChurn(bucket.rows);
  const total = totalRisk(bucket.rows);
  const hedgeUSD = hedge(bucket.rows);

  lines.push(`${isCurrent ? 'Current Quarter' : 'Next Quarter'}: ${bucket.label}`);
  lines.push(`Churn/Downsell Plan: ${planUSD != null ? fmtUSD(planUSD) : '[fill in]'}`);
  lines.push(`Churn/Downsell Flash / Most Likely: ${fmtUSD(flash)}`);
  lines.push(
    `Gap to Plan: ${planUSD != null ? fmtSignedUSD(flash - planUSD) : '[fill in once Plan is set]'}`,
  );
  lines.push(`Total Churn/Downsell Risk / Baseline: ${fmtUSD(total)}`);
  lines.push(`Hedge: ${fmtUSD(hedgeUSD)}`);

  // "Accounts with Hedge" — accounts with forecastHedgeUSD > 0
  const hedgeAccounts: { view: AccountView; opp: CanonicalOpportunity; usd: number }[] = [];
  const hedgeSeen = new Map<string, { view: AccountView; opp: CanonicalOpportunity; usd: number }>();
  for (const r of bucket.rows) {
    const hedgeUSD = r.opp.forecastHedgeUSD ?? 0;
    if (hedgeUSD <= 0) continue;
    const prev = hedgeSeen.get(r.view.account.accountId);
    if (!prev || hedgeUSD > prev.usd) {
      hedgeSeen.set(r.view.account.accountId, { view: r.view, opp: r.opp, usd: hedgeUSD });
    }
  }
  const sortedHedgeAccounts = Array.from(hedgeSeen.values())
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);
  lines.push(`Accounts with Hedge: ${fmtUSD(hedgeUSD)}`);
  if (sortedHedgeAccounts.length === 0) {
    lines.push(`  - None identified`);
  } else {
    for (const r of sortedHedgeAccounts) {
      lines.push(`  - ${r.view.account.accountName} (${fmtUSD(r.usd)}) - ${r.opp.closeDate}`);
    }
  }

  // "Accounts to Close Gap" — biggest red exposures (where saves move
  // the needle most) followed by the largest hedge in green.
  const gapAccounts = [
    ...topAccountsToCloseGap(bucket.rows, 'red', 3),
    ...topAccountsToCloseGap(bucket.rows, 'yellow', 2),
  ].slice(0, 5);
  const totalGapACV = gapAccounts.reduce((sum, r) => sum + r.usd, 0);
  lines.push(`Accounts to Close Gap: ${fmtUSD(totalGapACV)}`);
  if (gapAccounts.length === 0) {
    lines.push(`  - None identified`);
  } else {
    for (const r of gapAccounts) {
      lines.push(`  - ${r.view.account.accountName} (${fmtUSD(r.usd)}) - ${r.opp.closeDate}`);
    }
  }
  lines.push('');

  lines.push(
    `Key Saves/Improvements to close the gap from Total Churn/Downsell risk to Flash:`,
  );

  // Red — risk trending; current quarter only per the template ("Accounts in red - risk trending" appears in current quarter section).
  if (isCurrent) {
    const reds = topAccountsToCloseGap(bucket.rows, 'red', 5);
    lines.push(`Accounts in red - risk trending:`);
    if (reds.length === 0) lines.push(`  - None`);
    for (const r of reds) {
      lines.push(
        `  - ${r.view.account.accountName} (${fmtUSD(r.usd)}) - ${whatIsNeeded(r.view, r.opp)}`,
      );
    }
  }

  const yellows = topAccountsToCloseGap(bucket.rows, 'yellow', 5);
  lines.push(`Accounts in yellow - path to add hedge to the line:`);
  if (yellows.length === 0) lines.push(`  - None`);
  for (const r of yellows) {
    lines.push(
      `  - ${r.view.account.accountName} (${fmtUSD(r.usd)}) - ${whatIsNeeded(r.view, r.opp)}`,
    );
  }

  const greens = topAccountsToCloseGap(bucket.rows, 'green', 5);
  lines.push(`Accounts in green - path to capture the existing hedge already in the line:`);
  if (greens.length === 0) lines.push(`  - None`);
  for (const r of greens) {
    lines.push(
      `  - ${r.view.account.accountName} (${fmtUSD(r.usd)}) - ${whatIsNeeded(r.view, r.opp)}`,
    );
  }
  lines.push('');

  // Week-over-week
  const wow = wowChanges(bucket.rows, events);
  lines.push(`Week-over-week Changes - Improvements and increased risk:`);
  if (wow.length === 0) {
    lines.push(`  - No movement this week`);
  } else {
    for (const w of wow) {
      lines.push(`  ${w.sign} ${w.accountName} - ${w.detail}`);
    }
  }
  lines.push('');

  return lines;
}

/**
 * Generate the churn-call forecast script.
 *
 * Audience: CSE manager → leadership (plaintext, paste-ready).
 *
 * Design constraints (per 2026-04-29 user feedback):
 *   - Plaintext only. No markdown links, bold, or footnotes — the
 *     downstream surface is a Slack/email plaintext field.
 *   - Lens: CSE manager. Do not surface hygiene call-outs or coaching
 *     prompts; leadership doesn't act on those. Focus exclusively on
 *     revenue (churn risk, churn prevention, saves, hedges).
 *   - Two quarters: the quarter containing asOfDate, then the next.
 *   - Template structure follows the manager's existing script
 *     verbatim: Plan / Flash / Gap / Total Risk / Hedge / Accounts to
 *     Close Gap / Key Saves (red/yellow/green) / WoW changes.
 */
export function generateWeeklyForecast(input: ForecastInput): string {
  const { current, next } = bucketByQuarter(input.views, input.asOfDate);
  const lines: string[] = [];

  const today = new Date().toISOString().slice(0, 10);
  lines.push(`Expand 3 Quarterly Churn Forecast - ${today}`);
  lines.push('');

  lines.push(
    ...renderQuarterSection(
      current,
      input.changeEvents,
      input.plan?.currentQuarterUSD,
      true,
    ),
  );
  lines.push(
    ...renderQuarterSection(
      next,
      input.changeEvents,
      input.plan?.nextQuarterUSD,
      false,
    ),
  );

  return lines.join('\n').trimEnd() + '\n';
}

/** New name; same function — for callers that want the explicit intent. */
export const generateChurnCallScript = generateWeeklyForecast;
