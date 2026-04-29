// Composite Risk Score — explainable, weighted signal aggregation.
//
// Audit ref: F-05 in docs/audit/01_findings.md.
//
// This is the v0.1 scaffold called for in Phase 1 of the audit plan
// (docs/audit/02_plan.md, PR-A10). It runs SIDE-BY-SIDE with the
// existing `getRiskIdentifier` (Cerebro passthrough + fallbacks); the
// existing scoring isn't replaced. The Phase 2 follow-up swaps callers
// to use this score by default and adds the explainer pill UI.
//
// Design constraints:
//   1. Every signal is sourced from a field already present on the
//      canonical record today. No invented / future-source signals
//      contribute to v0.1; placeholders are documented but inert.
//   2. Each signal carries a {label, points, source} tuple so the UI
//      can render a per-account "why" panel without reverse-engineering
//      the math.
//   3. Score is capped at 100 — additive contributions cannot push the
//      visible score off-scale even when many signals fire at once.
//   4. The function is pure (no I/O, no Date.now() unless caller passes
//      a `now` clock) so it's straightforward to unit-test.
import type {
  AdapterSource,
  CanonicalAccount,
  CanonicalOpportunity,
  ChangeEvent,
} from '@mdas/canonical';

const DAY = 86_400_000;

export type RiskScoreBand = 'Low' | 'Medium' | 'High' | 'Critical';

export interface RiskScoreSignal {
  label: string;
  points: number;
  /** Which underlying canonical field / source this signal is grounded in. */
  source: AdapterSource | 'derived';
  /** Optional pointer to the field path on the canonical record. */
  field?: string;
}

export interface RiskScore {
  /** 0–100 capped composite. */
  score: number;
  band: RiskScoreBand;
  signals: RiskScoreSignal[];
  /**
   * `confidence` is "high" if the highest-weight signal (Cerebro Risk
   * Category) is present; otherwise "low" — managers should treat the
   * score as directional only.
   */
  confidence: 'high' | 'low';
}

const BAND_THRESHOLDS: { band: RiskScoreBand; min: number }[] = [
  { band: 'Critical', min: 75 },
  { band: 'High', min: 50 },
  { band: 'Medium', min: 25 },
  { band: 'Low', min: 0 },
];

function bandFor(score: number): RiskScoreBand {
  for (const t of BAND_THRESHOLDS) {
    if (score >= t.min) return t.band;
  }
  return 'Low';
}

function daysSince(iso: string | null | undefined, now: number): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - t) / DAY));
}

function daysUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now) / DAY);
}

export interface RiskScoreInputs {
  account: CanonicalAccount;
  opportunities: CanonicalOpportunity[];
  /**
   * WoW change events filtered to this account. The risk-score reads
   * only `field` and `category` so the ordering / structure of the
   * change feed is otherwise opaque here.
   */
  changeEvents?: ChangeEvent[];
  /** Injected clock for testability. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Cerebro passthrough — highest-weight signal because it's the SOR.
 * Returns null when Cerebro Risk Category is absent (the common case
 * in the current pilot since Glean doesn't expose this field; see
 * docs/integrations/cerebro.md).
 */
function cerebroPassthrough(account: CanonicalAccount): RiskScoreSignal | null {
  switch (account.cerebroRiskCategory) {
    case 'Critical':
      return { label: 'Cerebro Risk Category: Critical', points: 25, source: 'cerebro', field: 'cerebroRiskCategory' };
    case 'High':
      return { label: 'Cerebro Risk Category: High', points: 18, source: 'cerebro', field: 'cerebroRiskCategory' };
    case 'Medium':
      return { label: 'Cerebro Risk Category: Medium', points: 10, source: 'cerebro', field: 'cerebroRiskCategory' };
    case 'Low':
      return { label: 'Cerebro Risk Category: Low', points: 0, source: 'cerebro', field: 'cerebroRiskCategory' };
    default:
      return null;
  }
}

/**
 * Cerebro 7-risk count — one point per true risk, capped at 14.
 */
function cerebroRiskCount(account: CanonicalAccount): RiskScoreSignal | null {
  const r = account.cerebroRisks;
  if (!r) return null;
  const trueCount = (Object.values(r) as (boolean | null)[]).filter(Boolean).length;
  if (trueCount === 0) return null;
  return {
    label: `${trueCount} of 7 Cerebro risk flags true`,
    points: Math.min(14, trueCount * 2),
    source: 'cerebro',
    field: 'cerebroRisks',
  };
}

function sentimentSignal(account: CanonicalAccount): RiskScoreSignal | null {
  switch (account.cseSentiment) {
    case 'Confirmed Churn':
      return { label: 'CSE Sentiment: Confirmed Churn', points: 20, source: 'salesforce', field: 'cseSentiment' };
    case 'Red':
      return { label: 'CSE Sentiment: Red', points: 12, source: 'salesforce', field: 'cseSentiment' };
    case 'Yellow':
      return { label: 'CSE Sentiment: Yellow', points: 6, source: 'salesforce', field: 'cseSentiment' };
    default:
      return null;
  }
}

/**
 * Stale sentiment commentary — the §4.2 staleness signal expressed
 * vs. the 14d (Red/Yellow) and 30d (Green) SLA the existing hygiene
 * rule (`scoring.evaluateHygiene`) uses. Stale commentary is itself a
 * leading-risk signal: managers stop tending the account.
 */
function staleSentimentSignal(account: CanonicalAccount, now: number): RiskScoreSignal | null {
  // Concern separation: staleness fires only when the field HAS a value
  // but is past SLA. Missing-ness is surfaced on /admin/data-quality
  // (read-model.getDataQuality) so it doesn't double-count here.
  if (!account.cseSentimentCommentaryLastUpdated) return null;
  const days = daysSince(account.cseSentimentCommentaryLastUpdated, now);
  const isUrgent = account.cseSentiment === 'Red' || account.cseSentiment === 'Yellow';
  const sla = isUrgent ? 14 : 30;
  if (days <= sla) return null;
  // Penalize linearly past the SLA, capped at 10.
  const points = Math.min(10, Math.max(2, Math.floor((days - sla) / 7) + 2));
  return {
    label: `Sentiment commentary ${days}d old (SLA ${sla}d)`,
    points,
    source: 'salesforce',
    field: 'cseSentimentCommentaryLastUpdated',
  };
}

/**
 * Engagement decay — 30-day vs 90-day ratio < 1/3 of the proportional
 * baseline (i.e. the customer is engaging much less in the last 30d
 * than the trailing 90d would predict).
 */
function engagementDecaySignal(account: CanonicalAccount): RiskScoreSignal | null {
  const m30 = account.engagementMinutes30d;
  const m90 = account.engagementMinutes90d;
  if (m30 == null || m90 == null || m90 <= 0) return null;
  const expected30 = m90 / 3;
  if (expected30 <= 0) return null;
  const ratio = m30 / expected30;
  if (ratio >= 0.5) return null; // engagement is stable enough
  // ratio of 0 → 10 points; ratio of 0.5 → 0 points.
  const points = Math.round((1 - ratio * 2) * 10);
  if (points <= 0) return null;
  return {
    label: `Engagement decayed: 30d=${m30}m vs expected ${Math.round(expected30)}m`,
    points,
    source: 'salesforce',
    field: 'engagementMinutes30d',
  };
}

/**
 * WoW direction signal — derived from change events. A worsening
 * Cerebro Risk or Sentiment movement adds risk; an improving movement
 * subtracts it. Net contribution is bounded to [-10, +10].
 */
const RISK_ORDER: Record<string, number> = {
  Low: 0,
  Medium: 1,
  High: 2,
  Critical: 3,
};
const SENT_ORDER: Record<string, number> = {
  Green: 0,
  Yellow: 1,
  Red: 2,
  'Confirmed Churn': 3,
};

function wowDirectionSignal(events: ChangeEvent[]): RiskScoreSignal | null {
  if (events.length === 0) return null;
  let net = 0;
  const labels: string[] = [];
  for (const e of events) {
    if (e.field === 'cerebroRiskCategory') {
      const o = RISK_ORDER[String(e.oldValue ?? '')] ?? 0;
      const n = RISK_ORDER[String(e.newValue ?? '')] ?? 0;
      const delta = n - o;
      if (delta !== 0) {
        net += delta * 3;
        labels.push(`Risk ${e.oldValue ?? '∅'} → ${e.newValue ?? '∅'}`);
      }
    } else if (e.field === 'cseSentiment') {
      const o = SENT_ORDER[String(e.oldValue ?? '')] ?? 0;
      const n = SENT_ORDER[String(e.newValue ?? '')] ?? 0;
      const delta = n - o;
      if (delta !== 0) {
        net += delta * 3;
        labels.push(`Sentiment ${e.oldValue ?? '∅'} → ${e.newValue ?? '∅'}`);
      }
    }
  }
  if (net === 0) return null;
  const points = Math.max(-10, Math.min(10, net));
  return {
    label: labels.length ? `WoW movement: ${labels.join(', ')}` : 'WoW movement',
    points,
    source: 'derived',
    field: 'changeEvents',
  };
}

/**
 * Renewal proximity — the closer to renewal, the more weight on every
 * other signal. Implemented here as a small additive contribution that
 * fires only inside the 90-day window.
 */
function renewalProximitySignal(opps: CanonicalOpportunity[], now: number): RiskScoreSignal | null {
  const renewals = opps.filter((o) => /renewal/i.test(o.type) && o.closeDate);
  const candidates = renewals.length ? renewals : opps.filter((o) => o.closeDate);
  if (candidates.length === 0) return null;
  const earliest = candidates
    .map((o) => daysUntil(o.closeDate, now))
    .filter((d): d is number => d != null && d >= 0)
    .sort((a, b) => a - b)[0];
  if (earliest == null) return null;
  if (earliest > 90) return null;
  const points = earliest <= 30 ? 10 : earliest <= 60 ? 6 : 3;
  return {
    label: `Renewal in ${earliest}d`,
    points,
    source: 'salesforce',
    field: 'closeDate',
  };
}

/**
 * Confirmed-churn-notice signal — once a churn notice has been emitted
 * the account is unambiguously high-risk regardless of every other
 * signal. Independent so it shows up as a discrete row in the explainer.
 */
function churnNoticeSignal(opps: CanonicalOpportunity[]): RiskScoreSignal | null {
  const fired = opps.some(
    (o) => !!o.fullChurnNotificationToOwnerDate || !!o.fullChurnFinalEmailSentDate,
  );
  if (!fired) return null;
  return {
    label: 'Churn notice submitted',
    points: 30,
    source: 'salesforce',
    field: 'fullChurnNotificationToOwnerDate',
  };
}

export function computeRiskScore(input: RiskScoreInputs): RiskScore {
  const now = input.now ?? Date.now();
  const signals: RiskScoreSignal[] = [];
  const cerebro = cerebroPassthrough(input.account);
  if (cerebro) signals.push(cerebro);
  const cerebroCount = cerebroRiskCount(input.account);
  if (cerebroCount) signals.push(cerebroCount);
  const sent = sentimentSignal(input.account);
  if (sent) signals.push(sent);
  const stale = staleSentimentSignal(input.account, now);
  if (stale) signals.push(stale);
  const decay = engagementDecaySignal(input.account);
  if (decay) signals.push(decay);
  const wow = wowDirectionSignal(input.changeEvents ?? []);
  if (wow) signals.push(wow);
  const renewal = renewalProximitySignal(input.opportunities, now);
  if (renewal) signals.push(renewal);
  const churn = churnNoticeSignal(input.opportunities);
  if (churn) signals.push(churn);

  const raw = signals.reduce((s, x) => s + x.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return {
    score,
    band: bandFor(score),
    signals,
    confidence: cerebro ? 'high' : 'low',
  };
}
