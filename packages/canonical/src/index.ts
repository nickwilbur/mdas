// Canonical types for MDAS v0. Source of truth for downstream packages.

export type CSESentiment = 'Green' | 'Yellow' | 'Red' | 'Confirmed Churn' | null;
export type CerebroRiskCategory = 'Low' | 'Medium' | 'High' | 'Critical' | null;
export type MostLikelyConfidence = 'Confirmed' | 'High' | 'Medium' | 'Low' | 'Closed' | null;

// PR-C1 — F-22: canonicalize a free-form mostLikelyConfidence string
// (case-insensitive, trimmed) so non-SF adapters and ad-hoc imports
// can't smuggle 'confirmed' into the canonical record where the
// downstream consumer comparison `=== 'Confirmed'` would silently fail.
//
// The Salesforce mapper already does this; we expose the same logic
// here so future adapters and tests share one source of truth.
const MOST_LIKELY_CONFIDENCE_VALUES = ['Confirmed', 'High', 'Medium', 'Low', 'Closed'] as const;
export function normalizeMostLikelyConfidence(raw: string | null | undefined): MostLikelyConfidence {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  return MOST_LIKELY_CONFIDENCE_VALUES.find((c) => c.toLowerCase() === v) ?? null;
}
export type Bucket = 'Confirmed Churn' | 'Saveable Risk' | 'Healthy';

export type AdapterSource =
  | 'salesforce'
  | 'cerebro'
  | 'gainsight'
  | 'staircase'
  | 'zuora-mcp'
  | 'glean-mcp'
  | 'local-snapshots';

export type SourceLinkOrigin =
  | 'salesforce'
  | 'cerebro'
  | 'gainsight'
  | 'staircase'
  | 'zuora'
  | 'glean'
  | 'slack'
  | 'gmail'
  | 'calendar'
  | 'sheet';

export interface SourceLink {
  source: SourceLinkOrigin;
  label: string;
  url: string;
  /**
   * Optional Glean citation tuple for deep-linking from the Account Drill-In.
   * Populated only by Glean-sourced links.
   */
  citationId?: string;
  snippetIndex?: number;
}

/**
 * Per-source freshness map keyed by adapter source. Values are ISO 8601
 * timestamps recorded when the adapter last successfully populated the field
 * set it owns on this record. A missing entry means "never fetched from this
 * source"; a present entry older than the current refreshId means the field
 * set on this record is stale (the adapter ran but produced no new data).
 */
export type SourceFreshnessMap = Partial<Record<AdapterSource, string>>;

/**
 * Per-source non-fatal error map. When an adapter call fails or partially
 * fails, the worker records the error message keyed by source. A present
 * entry means: the field set this source owns may be stale and the UI should
 * surface that. A missing entry means: no error this refresh.
 */
export type SourceErrorMap = Partial<Record<AdapterSource, string>>;

export interface GainsightTask {
  id: string;
  title: string;
  owner: { id: string; name: string } | null;
  dueDate: string | null;
  status: string;
  ctaId: string | null;
}

export interface Workshop {
  id: string;
  engagementType: string;
  status: string;
  workshopDate: string | null;
}

export interface MeetingSummary {
  source: 'calendar' | 'zoom' | 'staircase';
  title: string;
  startTime: string;
  attendees: string[];
  summary: string | null;
  url: string | null;
}

export interface CerebroRisks {
  utilizationRisk: boolean | null;
  engagementRisk: boolean | null;
  suiteRisk: boolean | null;
  shareRisk: boolean | null;
  legacyTechRisk: boolean | null;
  expertiseRisk: boolean | null;
  pricingRisk: boolean | null;
}

export interface CanonicalAccount {
  accountId: string;
  salesforceAccountId: string;
  accountName: string;
  zuoraTenantId: string | null;

  accountOwner: { id: string; name: string } | null;
  assignedCSE: { id: string; name: string } | null;
  csCoverage: 'CSE' | 'ESA' | 'Digital' | null;

  franchise: string;

  cseSentiment: CSESentiment;
  cseSentimentCommentary: string | null;
  cseSentimentLastUpdated: string | null;
  cseSentimentCommentaryLastUpdated: string | null;

  cerebroRiskCategory: CerebroRiskCategory;
  cerebroRiskAnalysis: string | null;
  cerebroRisks: CerebroRisks;
  cerebroSubMetrics: Record<string, number | string | boolean | null>;

  allTimeARR: number | null;
  activeProductLines: string[];

  engagementMinutes30d: number | null;
  engagementMinutes90d: number | null;

  isConfirmedChurn: boolean;
  churnReason: string | null;
  churnReasonSummary: string | null;
  churnDate: string | null;

  gainsightTasks: GainsightTask[];
  workshops: Workshop[];
  recentMeetings: MeetingSummary[];
  accountPlanLinks: { title: string; url: string; lastModified: string }[];

  sourceLinks: SourceLink[];
  lastUpdated: string;

  /**
   * Per-source freshness — populated by the worker after each adapter completes.
   * Optional for backward compatibility with snapshots written before the
   * provenance refactor (PR-1, 2026-04-28). Readers MUST tolerate absence.
   */
  lastFetchedFromSource?: SourceFreshnessMap;

  /**
   * Per-source non-fatal errors from the most recent refresh. Optional for
   * backward compatibility. UI surfaces these as freshness-warning pills.
   */
  sourceErrors?: SourceErrorMap;
}

export interface CanonicalOpportunity {
  opportunityId: string;
  opportunityName: string;
  accountId: string;

  type: string;
  stageName: string;
  stageNum: number | null;
  closeDate: string;
  closeQuarter: string;
  fiscalYear: number;

  acv: number | null;
  availableToRenewUSD: number | null;
  forecastMostLikely: number | null;
  forecastMostLikelyOverride: number | null;
  mostLikelyConfidence: MostLikelyConfidence;
  forecastHedgeUSD: number | null;
  acvDelta: number | null;
  knownChurnUSD: number | null;
  productLine: string | null;

  flmNotes: string | null;
  slmNotes: string | null;
  scNextSteps: string | null;
  salesEngineer: { id: string; name: string } | null;

  fullChurnNotificationToOwnerDate: string | null;
  fullChurnFinalEmailSentDate: string | null;
  churnDownsellReason: string | null;

  sourceLinks: SourceLink[];
  lastUpdated: string;

  /** See CanonicalAccount.lastFetchedFromSource. Optional, backward-compatible. */
  lastFetchedFromSource?: SourceFreshnessMap;
  /** See CanonicalAccount.sourceErrors. Optional, backward-compatible. */
  sourceErrors?: SourceErrorMap;
}

export const isConfirmedChurn = (
  a: CanonicalAccount,
  opps: CanonicalOpportunity[],
): boolean =>
  a.cseSentiment === 'Confirmed Churn' ||
  opps.some(
    (o) =>
      !!o.fullChurnNotificationToOwnerDate ||
      !!o.fullChurnFinalEmailSentDate ||
      (o.knownChurnUSD !== null && o.knownChurnUSD > 0),
  );

// ---------- Adapter contract ----------

export interface AdapterFetchResult {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
}

/**
 * Minimal logger contract injected via RefreshContext. Adapters MUST NOT
 * import a logger statically; they receive one per refresh. Implementations
 * may be a console fallback or a structured logger.
 */
export interface AdapterLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Audit logger writes to the audit_log table via @mdas/db. Decoupled here
 * to avoid a circular package dependency.
 */
export interface AdapterAuditLogger {
  record(actor: string, event: string, details: Record<string, unknown>): Promise<void>;
}

/**
 * Context threaded through every adapter call by the worker orchestrator.
 * Replaces ad-hoc reads of process.env / console.log inside adapters.
 *
 * Adapter authors: do NOT cache values from ctx beyond a single fetch() call.
 * Each refresh constructs a fresh RefreshContext.
 */
export interface RefreshContext {
  /** UUID of the in-flight refresh_run row. */
  refreshId: string;
  /** Wall-clock time the refresh was started. Used as the source freshness stamp when an adapter succeeds. */
  asOf: Date;
  /** Franchise filter — currently always 'Expand 3'; threaded through for future multi-franchise support. */
  franchise: string;
  /** Structured logger scoped to this refresh. */
  logger: AdapterLogger;
  /** Audit logger for refresh-level events. */
  audit: AdapterAuditLogger;
}

/**
 * ReadAdapter v2 contract. Backward-compat note: the prior signature was
 * `fetch(opts: { franchise: string })`. The new signature accepts the
 * franchise via ctx and a typed input/output pair so individual adapters can
 * narrow what they consume and produce.
 *
 * For PR-1, all existing adapters keep the legacy single-arg signature via
 * the `LegacyReadAdapter` alias; the orchestrator constructs a
 * back-compat shim. Adapters will migrate to ReadAdapter<TInput, TOutput>
 * incrementally in PR-3+.
 */
export interface ReadAdapter<TInput = { franchise: string }, TOutput = AdapterFetchResult> {
  readonly name: string;
  readonly isReadOnly: true;
  readonly source?: AdapterSource;
  fetch(input: TInput, ctx?: RefreshContext): Promise<Partial<TOutput>>;
  /**
   * Optional health probe. Adapters that implement it report whether their
   * upstream is reachable; the worker can short-circuit on failure.
   */
  healthCheck?(ctx?: RefreshContext): Promise<{ ok: boolean; details: string }>;
}

// ---------- Scoring/view types ----------

export interface RiskIdentifier {
  level: CerebroRiskCategory | 'Unknown';
  source: 'cerebro' | 'fallback';
  rationale: string;
}

export type UpsellBand = 'Watch' | 'Qualified' | 'Active' | 'Hot';

export interface UpsellAssessment {
  score: number;
  band: UpsellBand;
  signals: { label: string; points: number }[];
}

export interface HygieneViolation {
  rule: string;
  description: string;
  coachingPrompt: string;
  confidence: 'high' | 'low';
  opportunityId?: string;
}

export interface ChangeEvent {
  accountId: string;
  opportunityId?: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  occurredBetween: [string, string]; // [prevRefreshId, currRefreshId]
  category:
    | 'risk'
    | 'sentiment'
    | 'forecast'
    | 'hygiene'
    | 'workshop'
    | 'churn-notice';
  label: string;
}

export interface AccountView {
  account: CanonicalAccount;
  opportunities: CanonicalOpportunity[];
  bucket: Bucket;
  risk: RiskIdentifier;
  /**
   * Composite Risk Score (PR-B1). Optional for backwards compatibility
   * with views serialized before the score existed: the read-model
   * enriches every fresh view with this field, but a cached snapshot
   * loaded from a pre-B1 worker run won't carry it. Renderers that use
   * it must be defensive (fall back to `risk` for display).
   *
   * Defined here, in canonical, so server reads and client renders
   * agree on shape without crossing the @mdas/scoring boundary.
   */
  riskScore?: {
    score: number;
    band: 'Low' | 'Medium' | 'High' | 'Critical';
    confidence: 'high' | 'low';
    signals: {
      label: string;
      points: number;
      source: AdapterSource | 'derived';
      field?: string;
    }[];
  };
  upsell: UpsellAssessment;
  hygiene: { score: number; violations: HygieneViolation[] };
  priorityRank: number;
  daysToRenewal: number | null;
  atrUSD: number;
  acvAtRiskUSD: number;
  changeEvents: ChangeEvent[];
}
