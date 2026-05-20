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
 * `Pipeline`, `Best Case`, `Commit`, `Omitted`, `Closed`. We
 * excluded-list the small stable "removed" set so renewals stay
 * visible across picklist drift.
 *
 * IMPORTANT: We do NOT drop the `*Upside` family — that was the
 * 2026-05-20 second-pass bug. A renewal opp can be categorized as
 * `Committed Upside` / `Targeted Upside` / `Upside` *and still* carry
 * a negative Most Likely or negative ACV delta (i.e., the rep is
 * forecasting a net downsell while also hedging some upside dollars).
 * Finale, Zello, and Kustomer are the manager-verified examples —
 * all three sit in Upside-family categories and are exactly the saves
 * the manager is carrying in Clari. The churn-save vs upsell-only
 * decision lives in `isChurnSaveTarget`, not the category filter.
 *
 * Null `forecastCategory` is treated as EXCLUDED — if SFDC has no
 * manager category at all, the opp has not been pulled onto the
 * manager's forecast line.
 */
const DROPPED_FORECAST_CATEGORIES = new Set([
  'omit',
  'omitted',
  'closed',
  'closed lost',
  'closed won',
]);

function isCarriedForecastCategory(opp: CanonicalOpportunity): boolean {
  const cat = (opp.forecastCategory ?? '').trim().toLowerCase();
  if (cat === '') return false;
  if (DROPPED_FORECAST_CATEGORIES.has(cat)) return false;
  return true;
}

/**
 * True when the renewal opp has a measurable down-forecast signal —
 * the rep is forecasting renewal dollars below ATR baseline, which is
 * the definition of a churn-save situation. We check the explicit
 * dollar fields rather than relying on account bucket because the
 * manager's Clari hedge list includes Healthy-bucketed accounts with
 * down-forecast renewals (Kustomer is the verified example —
 * Healthy/Yellow account, renewal at ML -$20K + ACV delta -$15K, on
 * the hedge line in Clari).
 */
function hasDownForecastSignal(opp: CanonicalOpportunity): boolean {
  if ((opp.knownChurnUSD ?? 0) > 0) return true;
  const ml = opp.forecastMostLikelyOverride ?? opp.forecastMostLikely;
  if (ml != null && ml < 0) return true;
  if (opp.acvDelta != null && opp.acvDelta < 0) return true;
  return false;
}

/**
 * Per the 2026-05-20 manager feedback (and the two follow-up
 * corrections): Hedge / Close-Gap sections surface renewal opps the
 * rep is actively forecasting *down* against ATR. A row qualifies
 * when ALL of:
 *   - the opportunity is a renewal (Type contains "Renewal");
 *   - the SFDC manager forecast category is set and not in the
 *     dropped set (Omitted / Closed*) — null category means the opp
 *     hasn't been pulled onto the manager's forecast line at all;
 *   - the opp itself carries a down-forecast signal (negative ML,
 *     negative ACV delta, or known churn USD).
 *
 * Account bucket is intentionally NOT a gate — Kustomer is the
 * verified counter-example (Healthy bucket, down-forecast renewal,
 * on the manager's Clari hedge list). Forecast hedge dollars are
 * also NOT a signal on their own — Pipedrive is the verified
 * counter-example (renewals at `Upside` with $25K hedge but ML and
 * ACV delta both $0, i.e., the rep is hedging pure upside, not a
 * save).
 */
function isChurnSaveTarget(_view: AccountView, opp: CanonicalOpportunity): boolean {
  if (!isRenewalLike(opp)) return false;
  if (!isCarriedForecastCategory(opp)) return false;
  if (!hasDownForecastSignal(opp)) return false;
  return true;
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
 * Salesforce / Gainsight rich-text fields (FLM/SLM notes, sentiment
 * commentary, Cerebro risk analysis) often arrive as HTML pasted by
 * the CSE or surfaced by Gainsight's editor — `<p>`, `<b>`, anchor
 * tags wrapping internal links, embedded `&nbsp;` / `&amp;` /
 * `&#39;`, and the occasional decorative `<div class="tk0j8o1 ...">`.
 * Rendering that raw in the leadership churn-call script reads as
 * truncated tag-soup. This helper strips markup, decodes the
 * entities the CSE notes actually use, and collapses whitespace so
 * the prose is paste-ready.
 */
function cleanRichText(s: string | null | undefined): string {
  if (!s) return '';
  let t = String(s);
  // Drop anchor tags wholesale — the visible text is almost always
  // empty (the SFDC/Gainsight UI renders these as inline icons) and
  // the href is noise in a plaintext script.
  t = t.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '');
  // Replace block-level closers and <br> with single spaces so the
  // resulting prose flows; then strip remaining tags.
  t = t.replace(/<\/(p|div|li|h\d|ul|ol)>/gi, ' ');
  t = t.replace(/<br\s*\/?>(\s*)/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');
  // Decode the small set of HTML entities CSE notes actually contain.
  // (We deliberately don't import a full entity decoder — every other
  // entity in observed snapshot data falls into this set.)
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  // Collapse runs of whitespace (including the spaces we just
  // inserted) and trim.
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/** Cap narrative at maxLen graphemes, ellipsizing at a word boundary. */
function truncateNarrative(s: string, maxLen = 500): string {
  if (s.length <= maxLen) return s;
  const slice = s.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  const cutAt = lastSpace > maxLen * 0.7 ? lastSpace : maxLen;
  return slice.slice(0, cutAt).trimEnd() + '…';
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
 * One-line summary for the Week-over-week section header.
 *
 * Format: `net $X (regressions -$Y, improvements +$Z, N booked)`.
 * When nothing moved, returns `no movement this week`.
 *
 * Per 2026-05-20 manager feedback the header was a static label; the
 * exec couldn't tell at a glance whether the week was net-positive or
 * net-negative without reading every bullet. We now surface the dollar
 * roll-up (forecastMostLikely deltas only — see WowHeaderSummary) and a
 * booked count (renewals that hit Closed/Won this week), so the
 * leadership read is immediate.
 */
function formatWowHeaderSummary(h: WowHeaderSummary): string {
  if (
    h.net === 0 &&
    h.regressions === 0 &&
    h.improvements === 0 &&
    h.booked === 0
  ) {
    return 'no movement this week';
  }
  const parts: string[] = [];
  if (h.regressions !== 0) parts.push(`regressions ${fmtSignedUSD(h.regressions)}`);
  if (h.improvements !== 0) parts.push(`improvements ${fmtSignedUSD(h.improvements)}`);
  if (h.booked > 0) parts.push(`${h.booked} booked`);
  const tail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `net ${fmtSignedUSD(h.net)}${tail}`;
}

/**
 * Compact, exec-readable chip line for a Key Saves bullet.
 *
 * Per 2026-05-20 manager feedback the prior implementation pasted
 * 500-char rich-text dumps (often the CSE's State / Renewal Risk
 * commentary) under each bullet — leadership found this unreadable on
 * the churn call. We now lead with a structured chip line built from
 * the same fields the manager already scans in Clari, and the prose
 * "what's needed" follows it as a single short sentence (see
 * `keySaveNeed`).
 *
 * Chips emitted (any with a value):
 *   - Risk: Cerebro Risk Category (`Critical`/`High`/…) — leadership
 *     anchor for whether the account is in the red bucket.
 *   - Sentiment: CSE Sentiment (`Red`/`Yellow`/`Confirmed Churn`/…) —
 *     the CSE's own gut on the account.
 *   - Renewal: opportunity close date (ISO `YYYY-MM-DD`).
 *   - ML: forecastMostLikely as signed USD. Down-forecasts are the
 *     reason the bullet exists, so we show the number directly rather
 *     than burying it in prose.
 *
 * Chips are joined with `; ` and omitted when the underlying field is
 * empty so the line stays compact for sparse accounts.
 */
function keySaveChips(view: AccountView, opp: CanonicalOpportunity): string {
  const chips: string[] = [];
  const risk = view.account.cerebroRiskCategory;
  if (risk) chips.push(`Risk: ${risk}`);
  const sent = view.account.cseSentiment;
  if (sent) chips.push(`Sentiment: ${sent}`);
  if (opp.closeDate) chips.push(`Renewal: ${opp.closeDate}`);
  const ml = opp.forecastMostLikely;
  if (typeof ml === 'number' && Number.isFinite(ml) && ml !== 0) {
    chips.push(`ML: ${fmtSignedUSD(ml)}`);
  }
  return chips.join('; ');
}

/**
 * Single-sentence "what's needed" string for a Key Saves bullet.
 *
 * Per 2026-05-20 manager feedback we deliberately do NOT fall back to
 * CSE sentiment commentary, FLM/SLM notes, Cerebro risk analysis, or
 * the synthetic risk rationale — those sources produced multi-paragraph
 * dumps that drowned the chip line. SC Next Steps is the only source
 * authored as a forward-looking action by the rep on the deal, so it's
 * the only source that maps cleanly onto a one-sentence ask.
 *
 * Returns the first sentence of `opp.scNextSteps`, HTML-stripped,
 * capped at 200 chars at a word boundary. Empty string when SC Next
 * Steps is empty, so the caller renders the bullet with just the chip
 * line — which is itself a complete summary.
 */
function keySaveNeed(opp: CanonicalOpportunity): string {
  const next = cleanRichText(opp.scNextSteps);
  if (!next) return '';
  const sentenceMatch = next.match(/^[^.!?]+[.!?]/);
  const firstSentence = (sentenceMatch ? sentenceMatch[0] : next).trim();
  return truncateNarrative(firstSentence, 200);
}

/**
 * Composes the post-`($amount) - ` segment for a Key Saves bullet:
 * chip line, then (when present) a single sentence of "what's needed".
 * Returns `''` when neither has content so `keySaveBullet` drops the
 * trailing ` - `.
 */
function keySaveDetail(view: AccountView, opp: CanonicalOpportunity): string {
  const chips = keySaveChips(view, opp);
  const need = keySaveNeed(opp);
  if (chips && need) return `${chips} | ${need}`;
  return chips || need;
}

/**
 * Top N saveable / red accounts in the quarter ordered by dollar
 * exposure. Returns one row per account (de-duplicated when an account
 * has multiple opps in the same quarter, taking the largest renewal).
 *
 * Per 2026-05-20 manager feedback: Key Saves was surfacing past-due
 * Amendment / New Business / Contracted Ramp opps because the only
 * filters were colorBand + acv > 0. An exec can't "save" an upsell
 * amendment, and the past close dates on those rows were the
 * tell-tale. We now restrict candidates to RENEWAL opps the manager
 * is still carrying on the forecast line — same `isRenewalLike` +
 * `isCarriedForecastCategory` filter the Hedge / Close-Gap sections
 * already use. We stop short of the full `isChurnSaveTarget` check
 * (which also requires a down-forecast signal) because the green band
 * legitimately contains healthy renewals the manager wants to
 * capture; an `acv > 0` renewal in forecast is a valid Key Save
 * candidate regardless of its current ML.
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
    if (!isRenewalLike(r.opp)) continue;
    if (!isCarriedForecastCategory(r.opp)) continue;
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
 * Week-over-week changes scoped to the quarter's accounts.
 *
 * Per 2026-05-20 manager feedback: the WoW section was silently
 * dropping every opportunity-level diff (stage moves, forecast ML
 * changes, close-date slips) because the original implementation only
 * surfaced account-level risk/sentiment/churn-notice events. Leadership
 * lost visibility into the most actionable signals — DataStax going to
 * Closed Won, D&B's forecast improving by $100K, etc.
 *
 * Now surfaces forecast-relevant signals with thresholds to keep the
 * list signal-dense rather than noisy:
 *   - cerebroRiskCategory change (any)
 *   - cseSentiment change (any)
 *   - churn-notice category event (any — already gated on prev=null)
 *   - stageName change WHERE the new stage starts with "Closed" OR the
 *     numeric prefix jumps ≥ 2 (e.g. 3.0 → 5.0). Skips 4.0 → 5.0.
 *   - forecastMostLikely change WHERE |delta| ≥ $25,000.
 *   - closeDate change WHERE |delta| ≥ 7 days.
 *
 * Multiple events on the same account are aggregated into a single
 * line with "; "-joined detail per account. The account-level sign is
 * "-" if ANY of its events is a regression (leadership-first), else
 * "+". This pins the existing test expectations (one bullet per
 * account with the strongest signal) while now actually reporting
 * what changed.
 */
interface WowSummary {
  accountName: string;
  sign: '+' | '-';
  details: { sign: '+' | '-'; text: string }[];
}

/**
 * Dollar / count roll-up across the WoW signals, used to populate the
 * Week-over-week section header. Computed inside wowChanges() so the
 * same scoping (eligible accounts × renewal opps) that gates the
 * per-account bullets also gates the header math — leadership reads
 * the header dollar value as "what changed in our churn-save forecast
 * this week," and double-counting expansion movement would mislead.
 *
 * - regressions: sum of negative forecastMostLikely deltas across in-scope events.
 * - improvements: sum of positive forecastMostLikely deltas across in-scope events.
 * - net: regressions + improvements.
 * - booked: count of distinct accounts whose renewal opp transitioned
 *   to a Closed/Won stage during the window.
 *
 * Stage and close-date events are intentionally not assigned a dollar
 * value here — the underlying forecastMostLikely change (when present)
 * carries the dollars, and a stage-only move with no ML change should
 * not synthesize a fake number.
 */
interface WowHeaderSummary {
  net: number;
  regressions: number;
  improvements: number;
  booked: number;
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

const ML_DELTA_THRESHOLD_USD = 25_000;
const CLOSE_DATE_DELTA_THRESHOLD_DAYS = 7;

function stageNumericPrefix(stage: string): number | null {
  const m = stage.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asDateMs(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

interface SignalDetail {
  sign: '+' | '-';
  text: string;
}

/**
 * Translate a single ChangeEvent into a leadership-relevant signal or
 * null if the event should be suppressed (sub-threshold, hygiene-only,
 * etc.). Pure function — keeps wowChanges() purely orchestrating.
 */
function eventToSignal(e: ChangeEvent): SignalDetail | null {
  if (e.field === 'cerebroRiskCategory') {
    const oldR = RISK_RANK[String(e.oldValue)] ?? 0;
    const newR = RISK_RANK[String(e.newValue)] ?? 0;
    if (newR === oldR) return null;
    return {
      sign: newR < oldR ? '+' : '-',
      text: `Risk ${e.oldValue ?? '∅'} → ${e.newValue ?? '∅'}`,
    };
  }
  if (e.field === 'cseSentiment') {
    const oldS = SENT_RANK[String(e.oldValue)] ?? 0;
    const newS = SENT_RANK[String(e.newValue)] ?? 0;
    if (newS === oldS) return null;
    return {
      sign: newS > oldS ? '+' : '-',
      text: `Sentiment ${e.oldValue ?? '∅'} → ${e.newValue ?? '∅'}`,
    };
  }
  if (e.category === 'churn-notice') {
    return { sign: '-', text: 'Churn notice submitted' };
  }
  if (e.field === 'stageName') {
    const oldStage = String(e.oldValue ?? '');
    const newStage = String(e.newValue ?? '');
    const newStartsClosed = /^\s*\d*\.?\d*\s*-?\s*Closed/i.test(newStage) ||
      newStage.toLowerCase().includes('closed');
    const oldPref = stageNumericPrefix(oldStage);
    const newPref = stageNumericPrefix(newStage);
    const jumpedFar =
      oldPref != null && newPref != null && Math.abs(newPref - oldPref) >= 2;
    if (!newStartsClosed && !jumpedFar) return null;
    // Sign: Closed Won / Closed/Won → +; Closed Lost / Closed/Lost → -;
    // mid-funnel forward jump (3.0 → 5.0) → +; backward jump → -.
    const nl = newStage.toLowerCase();
    let sign: '+' | '-' = '+';
    if (nl.includes('closed') && nl.includes('lost')) sign = '-';
    else if (nl.includes('closed') && nl.includes('won')) sign = '+';
    else if (oldPref != null && newPref != null) sign = newPref > oldPref ? '+' : '-';
    return { sign, text: `Stage ${oldStage} → ${newStage}` };
  }
  if (e.field === 'forecastMostLikely') {
    const o = asNumber(e.oldValue) ?? 0;
    const n = asNumber(e.newValue) ?? 0;
    const delta = n - o;
    if (Math.abs(delta) < ML_DELTA_THRESHOLD_USD) return null;
    return {
      sign: delta >= 0 ? '+' : '-',
      text: `Forecast ML ${fmtSignedUSD(o)} → ${fmtSignedUSD(n)} (${fmtSignedUSD(delta)})`,
    };
  }
  if (e.field === 'closeDate') {
    const o = asDateMs(e.oldValue);
    const n = asDateMs(e.newValue);
    if (o == null || n == null) return null;
    const deltaDays = Math.round((n - o) / (1000 * 60 * 60 * 24));
    if (Math.abs(deltaDays) < CLOSE_DATE_DELTA_THRESHOLD_DAYS) return null;
    return {
      sign: deltaDays <= 0 ? '+' : '-',
      text: `Close ${e.oldValue} → ${e.newValue} (${deltaDays > 0 ? '+' : ''}${deltaDays}d)`,
    };
  }
  return null;
}

function wowChanges(
  rows: QuarterBucket['rows'],
  events: ChangeEvent[],
): { summaries: WowSummary[]; header: WowHeaderSummary } {
  // Same lens as Hedge / Close-Gap (2026-05-20 manager feedback): only
  // report week-over-week movement on accounts that are themselves
  // churn-save targets — renewal opps with a forecasted downsell or
  // churn signal in the current snapshot. Expansion-only movement
  // (new business, amendments without renewal exposure, healthy
  // renewals trending up) is noise for the leadership churn call.
  const eligibleAccountIds = new Set<string>();
  // Track which opportunityIds on each eligible account are themselves
  // renewals; opp-level events on non-renewal opps for an eligible
  // account are dropped (e.g., an expansion Amendment's stage move on
  // an account that also has a down-forecast renewal).
  const renewalOppIds = new Set<string>();
  const nameById = new Map<string, string>();
  // All renewal opp IDs in the quarter (across every account), used
  // for the "recently closed-won" exception below. We need this so we
  // can promote an account into the WoW list when its renewal just
  // booked (i.e., transitioned to a Closed/Won stage during the
  // window), even though the current snapshot now categorizes the
  // renewal as Closed and isChurnSaveTarget would otherwise exclude
  // it. Leadership wants to hear about wins that just closed.
  const renewalOppToAccount = new Map<string, { accountId: string; name: string }>();

  for (const r of rows) {
    if (isRenewalLike(r.opp)) {
      renewalOppToAccount.set(r.opp.opportunityId, {
        accountId: r.view.account.accountId,
        name: r.view.account.accountName,
      });
    }
    if (!isChurnSaveTarget(r.view, r.opp)) continue;
    eligibleAccountIds.add(r.view.account.accountId);
    nameById.set(r.view.account.accountId, r.view.account.accountName);
  }

  // "Recently closed-won" exception: scan stageName events for renewal
  // opps in the quarter whose new value indicates a Closed/Won stage,
  // and promote their accounts into the eligible set. We deliberately
  // do not extend this to Closed/Lost — those rep concessions are
  // already captured by the underlying churn-save filter on prior
  // weeks (the ATR exposure was visible before it was conceded).
  for (const e of events) {
    if (e.field !== 'stageName') continue;
    if (e.opportunityId == null) continue;
    const meta = renewalOppToAccount.get(e.opportunityId);
    if (!meta) continue;
    const newStage = String(e.newValue ?? '').toLowerCase();
    if (!(newStage.includes('closed') && newStage.includes('won'))) continue;
    eligibleAccountIds.add(meta.accountId);
    nameById.set(meta.accountId, meta.name);
    renewalOppIds.add(e.opportunityId);
  }

  // Second pass: for every opportunity (in the quarter) on an
  // eligible account, mark the renewal opps so we can scope opp-level
  // diffs. We can't rely on isChurnSaveTarget here because a renewal
  // on the account may not itself trigger the filter (e.g., a second
  // renewal opp at $0 ML on the same account), but its diffs are still
  // relevant context for the manager.
  for (const r of rows) {
    if (!eligibleAccountIds.has(r.view.account.accountId)) continue;
    if (isRenewalLike(r.opp)) renewalOppIds.add(r.opp.opportunityId);
  }

  const byAccount = new Map<string, SignalDetail[]>();
  let regressions = 0;
  let improvements = 0;
  const bookedAccountIds = new Set<string>();

  for (const e of events) {
    if (!eligibleAccountIds.has(e.accountId)) continue;
    // Opp-level events only count when the opp is a renewal on this
    // account. Account-level events (no opportunityId) pass through —
    // they're sentiment / risk / churn-notice signals that already
    // describe the whole account.
    if (e.opportunityId != null && !renewalOppIds.has(e.opportunityId)) continue;
    const sig = eventToSignal(e);
    if (!sig) continue;

    // Roll up header totals from the same events we render. ML deltas
    // contribute dollars; stage→Closed/Won transitions on renewal opps
    // contribute to the `booked` count.
    if (e.field === 'forecastMostLikely') {
      const o = asNumber(e.oldValue) ?? 0;
      const n = asNumber(e.newValue) ?? 0;
      const delta = n - o;
      if (Math.abs(delta) >= ML_DELTA_THRESHOLD_USD) {
        if (delta < 0) regressions += delta;
        else improvements += delta;
      }
    } else if (
      e.field === 'stageName' &&
      e.opportunityId != null &&
      renewalOppIds.has(e.opportunityId)
    ) {
      const newStage = String(e.newValue ?? '').toLowerCase();
      if (newStage.includes('closed') && newStage.includes('won')) {
        bookedAccountIds.add(e.accountId);
      }
    }

    const list = byAccount.get(e.accountId) ?? [];
    list.push(sig);
    byAccount.set(e.accountId, list);
  }

  const summaries: WowSummary[] = [];
  for (const [accountId, details] of byAccount.entries()) {
    if (details.length === 0) continue;
    const name = nameById.get(accountId) ?? accountId;
    // Account-level sign: regression wins (leadership-first).
    const sign: '+' | '-' = details.some((d) => d.sign === '-') ? '-' : '+';
    // Stable detail order: regressions first, then improvements.
    const orderedDetails = [...details].sort((a, b) => {
      if (a.sign !== b.sign) return a.sign === '-' ? -1 : 1;
      return 0;
    });
    summaries.push({ accountName: name, sign, details: orderedDetails });
  }

  // Stable order: regressions first (leadership wants the bad news),
  // then improvements; alphabetical within each.
  const sorted = summaries.sort((a, b) => {
    if (a.sign !== b.sign) return a.sign === '-' ? -1 : 1;
    return a.accountName.localeCompare(b.accountName);
  });

  return {
    summaries: sorted,
    header: {
      net: regressions + improvements,
      regressions,
      improvements,
      booked: bookedAccountIds.size,
    },
  };
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
  lines.push('');

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
    `Churn-save targets not yet hedged in Clari (ATR exposed): ${fmtUSD(targetsWithoutHedgeTotal)}`,
  );
  if (targetsWithoutHedge.length === 0) {
    lines.push(`  - None identified`);
  } else {
    for (const r of targetsWithoutHedge) {
      lines.push(
        `  - ${r.view.account.accountName} (${fmtUSD(r.usd)} ATR) - ${r.opp.closeDate}`,
      );
    }
  }
  lines.push('');

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

  // Week-over-week — placed above Key Saves so leadership sees what
  // moved this week before drilling into per-account narrative.
  // (Moved from below Key Saves on 2026-05-20.)
  const { summaries: wow, header: wowHeader } = wowChanges(bucket.rows, events);
  lines.push(
    `Week-over-week Changes - Improvements and increased risk: ${formatWowHeaderSummary(wowHeader)}`,
  );
  if (wow.length === 0) {
    lines.push(`  - No movement this week`);
  } else {
    for (const w of wow) {
      const detail = w.details
        .map((d) => `${d.sign === '-' ? '↓' : '↑'} ${d.text}`)
        .join('; ');
      lines.push(`  ${w.sign} ${w.accountName} - ${detail}`);
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
          keySaveDetail(r.view, r.opp),
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
        keySaveDetail(r.view, r.opp),
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
        keySaveDetail(r.view, r.opp),
      ),
    );
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
