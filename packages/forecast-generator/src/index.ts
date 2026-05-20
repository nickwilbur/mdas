import type { AccountView, CanonicalOpportunity, ChangeEvent } from '@mdas/canonical';
import {
  parseClariManagerForecastExportCsv,
  selectLatestClariForecastValue,
  timeframeMatchesFiscalQuarter,
  type ClariForecastSelection,
  type ClariManagerForecastRow,
} from './clari-manager-forecast.js';
import { fiscalQuarterFromDate, fiscalQuarterLabel } from './fiscal.js';

// PR-C3 — re-export Clari CSV + dark-account helpers from the public
// surface of @mdas/forecast-generator.
export { generateClariCsv, findDarkAccounts } from './clari-csv.js';
export type { ClariCsvOptions, DarkAccount } from './clari-csv.js';

export {
  parseClariManagerForecastExportCsv,
  parseClariNumericDataValue,
  selectLatestClariForecastValue,
  timeframeMatchesFiscalQuarter,
  CLARI_FORECAST_SOURCE_LABEL,
} from './clari-manager-forecast.js';
export type {
  ClariForecastSelection,
  ClariManagerForecastRow,
  SelectClariForecastValueOpts,
} from './clari-manager-forecast.js';

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
  /**
   * Pasted Clari manager forecast export CSV (same columns as the
   * export: Role, Timeframe, Field, Week, Data Type, Data Value, …).
   * When present, headline **Churn/Downsell Flash / Most Likely** (and
   * optional Plan / Hedge from matching Forecast Value rows) are read
   * deterministically — account roll-ups never override Flash.
   */
  clariManagerForecastCsv?: string;
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

/** True when SFDC Type is a renewal (handles “Renewal”, “Existing Business - Renewal”, etc.). */
function isRenewalLike(opp: CanonicalOpportunity): boolean {
  return String(opp.type ?? '')
    .toLowerCase()
    .includes('renewal');
}

/**
 * Forecast categories the manager has explicitly *removed* from the
 * churn-save line. Zuora's `fml_Manager_ForecastCategory__c` picklist
 * uses values like `Committed Upside`, `Targeted Upside`, `Upside`,
 * `Pipeline`, `Best Case`, `Commit`, `Omitted`, `Closed`. The set of
 * "carrying" values varies by quarter / instance, so we excluded-list
 * the small, stable "not carrying" set instead of allowlisting the
 * positive cases (which would silently drop valid renewals when Zuora
 * tweaks the picklist).
 *
 * Null `forecastCategory` is treated as EXCLUDED for hedge/close-gap —
 * if SFDC has no manager category at all, the opp has not been pulled
 * onto the manager's forecast line and shouldn't be reported as if it
 * had been. Previously we treated null as "include" so legacy snapshots
 * wouldn't go silent, but that re-introduced the very Pipedrive/Bamboo
 * leakage the filter was meant to fix (2026-05-20 follow-up).
 */
const DROPPED_FORECAST_CATEGORIES = new Set([
  'omit',
  'omitted',
  'closed',
  'closed lost',
  'closed won',
]);

/**
 * Zuora's manager picklist also carries `Upside` / `Targeted Upside` /
 * `Committed Upside` for renewal opps where the rep believes there's
 * net-new ACV to capture *at* the renewal. Per 2026-05-20 manager
 * feedback, those are *expansion* hedge dollars, not churn-save hedge
 * — Pipedrive's two Upside renewals were the prompting example. Drop
 * any category whose lowercased form contains "upside" so the
 * leadership-facing Hedge section is unambiguously about saves.
 */
function isUpsideCategory(cat: string): boolean {
  return cat.includes('upside');
}

function isCarriedForecastCategory(opp: CanonicalOpportunity): boolean {
  const cat = (opp.forecastCategory ?? '').trim().toLowerCase();
  if (cat === '') return false;
  if (DROPPED_FORECAST_CATEGORIES.has(cat)) return false;
  if (isUpsideCategory(cat)) return false;
  return true;
}

/**
 * Per the 2026-05-20 manager feedback: Hedge / Close-Gap sections must
 * only surface **churn-save** opportunities, not expansion hedge. A
 * row qualifies when:
 *   - the opportunity is a renewal (Type contains "Renewal"), AND
 *   - the SFDC manager forecast category is one we're still carrying
 *     (Commit / Best Case / Pipeline — not Omit / Closed), AND
 *   - either the account is bucketed as Confirmed Churn / Saveable Risk,
 *     OR the opp itself shows a churn signal (known churn USD, negative
 *     ML, negative ACV delta, or any hedge dollars at all).
 *
 * The third clause keeps the "renewal at Best Case with hedge but
 * healthy account" case visible — those are exactly the saves the
 * manager is hedging in Clari.
 */
function isChurnSaveTarget(view: AccountView, opp: CanonicalOpportunity): boolean {
  if (!isRenewalLike(opp)) return false;
  if (!isCarriedForecastCategory(opp)) return false;

  if (view.bucket === 'Confirmed Churn' || view.bucket === 'Saveable Risk') {
    return true;
  }
  if ((opp.knownChurnUSD ?? 0) > 0) return true;
  const ml = opp.forecastMostLikelyOverride ?? opp.forecastMostLikely;
  if (ml != null && ml < 0) return true;
  if (opp.acvDelta != null && opp.acvDelta < 0) return true;
  // Note: forecastHedgeUSD > 0 alone is intentionally NOT a signal here.
  // A renewal on a Healthy account can carry hedge dollars when the rep
  // is hedging upside, not churn risk (the upside-category check above
  // catches the obvious case, but Zuora picklists drift — keep this
  // belt-and-suspenders). Bucket and the explicit churn-dollar signals
  // are the only ways an account makes the Hedge / Close-Gap list.
  return false;
}

/**
 * Per-opportunity churn/downsell for the **MDAS-estimated Flash** roll-up
 * (negative dollars, aligned to Salesforce signals that drive Clari).
 *
 * Only **renewal** opportunities contribute via forecast / ACV delta.
 * (Expand 3 scope is already enforced upstream in `getDashboardData`.)
 *
 * Inclusion matches the churn window definition:
 *   - Known churn USD (positive in SFDC) → negative of that amount (any type).
 *   - Else renewal only: forecast most likely (incl. override) negative → that value.
 *   - Else renewal only: canonical acvDelta (derived / Billing ACV delta in SFDC) negative → that value.
 *
 * We do **not** sum `ATR − positive ML` (“retention gap”) — that inflated Flash
 * vs manager / Clari roll-ups. When a Clari manager CSV is pasted, Flash still
 * comes from `selectLatestClariForecastValue` and overrides this sum.
 */
function opportunityChurnFlashUSD(opp: CanonicalOpportunity): number {
  const known = opp.knownChurnUSD ?? 0;
  if (known > 0) return -known;

  if (!isRenewalLike(opp)) return 0;

  const ml = opp.forecastMostLikelyOverride ?? opp.forecastMostLikely;
  if (ml != null && ml < 0) return ml;

  const ad = opp.acvDelta;
  if (ad != null && ad < 0) return ad;

  return 0;
}

/** MDAS-estimated Flash (sum of per-opp churn components). */
function mdasAccountFlashChurnUSD(rows: QuarterBucket['rows']): number {
  return rows.reduce((s, r) => s + opportunityChurnFlashUSD(r.opp), 0);
}

const CLARI_ROLE = 'FLM Expand 3';
const CLARI_DATA_TYPE = 'Forecast Value';

function clariSelectionForQuarter(
  rows: ClariManagerForecastRow[],
  fiscalQuarterKey: string,
  field: string,
): ClariForecastSelection | null {
  return selectLatestClariForecastValue(rows, {
    role: CLARI_ROLE,
    timeframeMatches: (tf) => timeframeMatchesFiscalQuarter(tf, fiscalQuarterKey),
    field,
    dataType: CLARI_DATA_TYPE,
  });
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
 * Internal / scoring-fallback rationales we do NOT paste into the
 * leadership-facing forecast. These come from
 * `@mdas/scoring::getRiskIdentifier` when Cerebro Risk Category is
 * absent (Glean's Cerebro datasource doesn't expose Risk Category at all
 * — see packages/adapters/read/cerebro-glean/src/mapper.ts header) or
 * when we only have sentiment to fall back to. They are useful in the
 * MDAS UI as a “why bucketed here” hint, but in a manager script they
 * read as apology copy. Suppress them so bullets only show real,
 * actionable narrative (`SE_Next_Steps__c`, FLM/SLM notes, sentiment
 * commentary, churn reason, real Cerebro Risk Analysis).
 */
const FALLBACK_RATIONALE_PATTERNS: RegExp[] = [
  /^\d+ of 7 Cerebro risks (is|are) True/i,
  /^CSE Sentiment (Red|Yellow); no Cerebro data$/i,
  /^Cerebro Risk Category \(no analysis text available\)$/i,
  /^No Cerebro Risk Category and no fallback signals available$/i,
  /^Cerebro Risk Category (Low|Medium|High|Critical)$/i,
];

function isPasteableNarrative(s: string | null | undefined): boolean {
  const t = (s ?? '').trim();
  if (t.length === 0) return false;
  return !FALLBACK_RATIONALE_PATTERNS.some((re) => re.test(t));
}

function firstNonEmptyLine(s: string | null | undefined): string {
  if (!s) return '';
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

/**
 * One-line “what’s needed” for Key Saves bullets. Returns the first
 * substantive signal from the data the CSE / FLM has already captured;
 * never invents text and never echoes a scoring-fallback rationale.
 *
 * Order of preference:
 *   1. `SE_Next_Steps__c` (`opp.scNextSteps`) — most actionable.
 *   2. For Confirmed Churn: `Account.churnReasonSummary`.
 *   3. `FLM_Notes__c` / `SLM_Notes__c` — manager-authored.
 *   4. `cseSentimentCommentary` — the CSE’s own one-liner.
 *   5. `cerebroRiskAnalysis` directly (only when present — Cerebro AI
 *      narrative). Never the synthetic `view.risk.rationale` strings.
 *
 * If none of the above are present, returns `''` so the caller renders
 * `name ($amount)` with no apology copy.
 */
function whatIsNeeded(view: AccountView, opp: CanonicalOpportunity): string {
  const next = firstNonEmptyLine(opp.scNextSteps);
  if (next) return next.slice(0, 160);

  const churn = view.account.churnReasonSummary?.trim();
  if (view.bucket === 'Confirmed Churn' && churn) return churn.slice(0, 160);

  const flm = firstNonEmptyLine(opp.flmNotes);
  if (flm) return flm.slice(0, 160);
  const slm = firstNonEmptyLine(opp.slmNotes);
  if (slm) return slm.slice(0, 160);

  const sentimentCommentary = firstNonEmptyLine(
    view.account.cseSentimentCommentary,
  );
  if (sentimentCommentary) return sentimentCommentary.slice(0, 160);

  const cerebroAnalysis = firstNonEmptyLine(view.account.cerebroRiskAnalysis);
  if (cerebroAnalysis && isPasteableNarrative(cerebroAnalysis)) {
    return cerebroAnalysis.slice(0, 160);
  }

  const rationale = view.risk.rationale?.trim();
  if (isPasteableNarrative(rationale)) return rationale!.slice(0, 160);

  return '';
}

function keySaveBullet(
  accountName: string,
  usdLabel: string,
  detail: string,
): string {
  const d = detail.trim();
  return d ? `  - ${accountName} (${usdLabel}) - ${d}` : `  - ${accountName} (${usdLabel})`;
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
  clariRows: ClariManagerForecastRow[],
): string[] {
  const lines: string[] = [];
  const clariFlash = clariSelectionForQuarter(
    clariRows,
    bucket.key,
    'Churn/Downsell Flash',
  );
  const clariPlan = clariSelectionForQuarter(
    clariRows,
    bucket.key,
    'Churn/Downsell Plan',
  );
  const clariHedge = clariSelectionForQuarter(clariRows, bucket.key, 'Hedge');

  const resolvedPlan = planUSD ?? clariPlan?.clariForecastValue;
  const flash =
    clariFlash?.clariForecastValue ?? mdasAccountFlashChurnUSD(bucket.rows);

  const total = totalRisk(bucket.rows);
  const hedgeUSD =
    clariHedge?.clariForecastValue ?? hedge(bucket.rows);

  lines.push(`${isCurrent ? 'Current Quarter' : 'Next Quarter'}: ${bucket.label}`);
  lines.push(
    `Churn/Downsell Plan: ${resolvedPlan != null ? fmtSignedUSD(resolvedPlan) : '[fill in]'}`,
  );
  lines.push(
    `Churn/Downsell Flash / Most Likely: ${fmtSignedUSD(flash)}`,
  );
  lines.push(
    `Gap to Plan: ${resolvedPlan != null ? fmtSignedUSD(flash - resolvedPlan) : '[fill in once Plan is set]'}`,
  );
  lines.push(`Total Churn/Downsell Risk / Baseline: ${fmtSignedUSD(-total)}`);
  lines.push(`Hedge: ${fmtUSD(hedgeUSD)}`);

  // "Accounts with Hedge" — only renewal opps the manager is carrying
  // in Clari (Commit / Best Case / Pipeline) on accounts where a save
  // is still in play. Expansion-hedge opps (e.g., Pipedrive/BambooHR
  // upsells) are intentionally excluded — leadership reads this list
  // as "renewal saves we've already hedged in the forecast."
  const hedgeSeen = new Map<
    string,
    { view: AccountView; opp: CanonicalOpportunity; usd: number }
  >();
  for (const r of bucket.rows) {
    if (!isChurnSaveTarget(r.view, r.opp)) continue;
    const oppHedgeUSD = r.opp.forecastHedgeUSD ?? 0;
    if (oppHedgeUSD <= 0) continue;
    const prev = hedgeSeen.get(r.view.account.accountId);
    if (!prev || oppHedgeUSD > prev.usd) {
      hedgeSeen.set(r.view.account.accountId, {
        view: r.view,
        opp: r.opp,
        usd: oppHedgeUSD,
      });
    }
  }
  const sortedHedgeAccounts = Array.from(hedgeSeen.values())
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);
  const churnSaveHedgeTotal = sortedHedgeAccounts.reduce(
    (s, r) => s + r.usd,
    0,
  );
  lines.push(`Accounts with Hedge (churn-save renewals): ${fmtUSD(churnSaveHedgeTotal)}`);
  if (sortedHedgeAccounts.length === 0) {
    lines.push(`  - None identified`);
  } else {
    for (const r of sortedHedgeAccounts) {
      lines.push(`  - ${r.view.account.accountName} (${fmtUSD(r.usd)}) - ${r.opp.closeDate}`);
    }
  }

  // Churn-save targets MDAS believes belong in the hedge list but that
  // currently carry $0 forecast hedge — i.e., renewals at Confirmed
  // Churn / Saveable Risk (or with explicit churn dollars) that the CSE
  // hasn't yet pulled onto the Clari hedge line. This is the explicit
  // "we should call them out" ask: surface saves that aren't yet on
  // the manager's roll-up so leadership can decide to hedge them.
  const hedgedIds = new Set(sortedHedgeAccounts.map((r) => r.view.account.accountId));
  const targetsWithoutHedgeSeen = new Map<
    string,
    { view: AccountView; opp: CanonicalOpportunity; usd: number }
  >();
  for (const r of bucket.rows) {
    if (!isChurnSaveTarget(r.view, r.opp)) continue;
    if ((r.opp.forecastHedgeUSD ?? 0) > 0) continue;
    if (hedgedIds.has(r.view.account.accountId)) continue;
    const atr = r.opp.availableToRenewUSD ?? r.opp.acv ?? 0;
    if (atr <= 0) continue;
    const prev = targetsWithoutHedgeSeen.get(r.view.account.accountId);
    if (!prev || atr > prev.usd) {
      targetsWithoutHedgeSeen.set(r.view.account.accountId, {
        view: r.view,
        opp: r.opp,
        usd: atr,
      });
    }
  }
  const targetsWithoutHedge = Array.from(targetsWithoutHedgeSeen.values())
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);
  const targetsWithoutHedgeTotal = targetsWithoutHedge.reduce(
    (s, r) => s + r.usd,
    0,
  );
  lines.push(
    `  Churn-save targets not yet hedged in Clari (ATR exposed): ${fmtUSD(targetsWithoutHedgeTotal)}`,
  );
  if (targetsWithoutHedge.length === 0) {
    lines.push(`    - None identified`);
  } else {
    for (const r of targetsWithoutHedge) {
      lines.push(
        `    - ${r.view.account.accountName} (${fmtUSD(r.usd)} ATR) - ${r.opp.closeDate}`,
      );
    }
  }

  // "Accounts to Close Gap" — same churn-save filter, then rank by ATR
  // (dollars that move the gap-to-Plan needle), not by total ACV. We
  // still bias toward red over yellow because that's where save effort
  // is highest leverage.
  const gapSeen = new Map<
    string,
    { view: AccountView; opp: CanonicalOpportunity; usd: number; band: 'red' | 'yellow' }
  >();
  for (const r of bucket.rows) {
    if (!isChurnSaveTarget(r.view, r.opp)) continue;
    const band = colorBand(r.view);
    if (band !== 'red' && band !== 'yellow') continue;
    const atr = r.opp.availableToRenewUSD ?? r.opp.acv ?? 0;
    if (atr <= 0) continue;
    const prev = gapSeen.get(r.view.account.accountId);
    if (!prev || atr > prev.usd) {
      gapSeen.set(r.view.account.accountId, { view: r.view, opp: r.opp, usd: atr, band });
    }
  }
  const allGap = Array.from(gapSeen.values());
  const gapReds = allGap.filter((r) => r.band === 'red').sort((a, b) => b.usd - a.usd).slice(0, 3);
  const gapYellows = allGap.filter((r) => r.band === 'yellow').sort((a, b) => b.usd - a.usd).slice(0, 2);
  const gapAccounts = [...gapReds, ...gapYellows].slice(0, 5);
  const totalGapATR = gapAccounts.reduce((sum, r) => sum + r.usd, 0);
  lines.push(`Accounts to Close Gap (churn-save renewals): ${fmtUSD(totalGapATR)}`);
  if (gapAccounts.length === 0) {
    lines.push(`  - None identified`);
  } else {
    for (const r of gapAccounts) {
      lines.push(`  - ${r.view.account.accountName} (${fmtUSD(r.usd)} ATR) - ${r.opp.closeDate}`);
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
        keySaveBullet(
          r.view.account.accountName,
          fmtUSD(r.usd),
          whatIsNeeded(r.view, r.opp),
        ),
      );
    }
  }

  const yellows = topAccountsToCloseGap(bucket.rows, 'yellow', 5);
  lines.push(`Accounts in yellow - path to add hedge to the line:`);
  if (yellows.length === 0) lines.push(`  - None`);
  for (const r of yellows) {
    lines.push(
      keySaveBullet(
        r.view.account.accountName,
        fmtUSD(r.usd),
        whatIsNeeded(r.view, r.opp),
      ),
    );
  }

  const greens = topAccountsToCloseGap(bucket.rows, 'green', 5);
  lines.push(`Accounts in green - path to capture the existing hedge already in the line:`);
  if (greens.length === 0) lines.push(`  - None`);
  for (const r of greens) {
    lines.push(
      keySaveBullet(
        r.view.account.accountName,
        fmtUSD(r.usd),
        whatIsNeeded(r.view, r.opp),
      ),
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

  const clariRows = input.clariManagerForecastCsv
    ? parseClariManagerForecastExportCsv(input.clariManagerForecastCsv)
    : [];

  const stamp = new Date().toISOString().slice(0, 10);
  lines.push(`Expand 3 Quarterly Churn Forecast - ${stamp}`);
  lines.push('');

  lines.push(
    ...renderQuarterSection(
      current,
      input.changeEvents,
      input.plan?.currentQuarterUSD,
      true,
      clariRows,
    ),
  );
  lines.push(
    ...renderQuarterSection(
      next,
      input.changeEvents,
      input.plan?.nextQuarterUSD,
      false,
      clariRows,
    ),
  );

  return lines.join('\n').trimEnd() + '\n';
}

/** New name; same function — for callers that want the explicit intent. */
export const generateChurnCallScript = generateWeeklyForecast;
