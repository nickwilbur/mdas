// Canonical types for MDAS v0. Source of truth for downstream packages.

export type CSESentiment = 'Green' | 'Yellow' | 'Red' | 'Confirmed Churn' | null;
export type CerebroRiskCategory = 'Low' | 'Medium' | 'High' | 'Critical' | null;
export type MostLikelyConfidence = 'Confirmed' | 'High' | 'Medium' | 'Low' | 'Closed' | null;
export type Bucket = 'Confirmed Churn' | 'Saveable Risk' | 'Healthy';

export interface SourceLink {
  source:
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
  label: string;
  url: string;
}

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
}

export const isConfirmedChurn = (
  a: CanonicalAccount,
  opps: CanonicalOpportunity[],
): boolean =>
  a.cseSentiment === 'Confirmed Churn' ||
  opps.some(
    (o) => !!o.fullChurnNotificationToOwnerDate || !!o.fullChurnFinalEmailSentDate,
  );

// ---------- Adapter contract ----------

export interface AdapterFetchResult {
  accounts: CanonicalAccount[];
  opportunities: CanonicalOpportunity[];
}

export interface ReadAdapter {
  readonly name: string;
  readonly isReadOnly: true;
  fetch(opts: { franchise: string }): Promise<Partial<AdapterFetchResult>>;
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
  upsell: UpsellAssessment;
  hygiene: { score: number; violations: HygieneViolation[] };
  priorityRank: number;
  daysToRenewal: number | null;
  atrUSD: number;
  acvAtRiskUSD: number;
  changeEvents: ChangeEvent[];
}
