import type { AccountView } from '@mdas/canonical';

export const ACCOUNT_PLAN_SCHEMA_VERSION = '1.0.0';

export type AccountPlanFranchise = 'Expand 3';

export type AccountPlanStatus = 'generated' | 'failed' | 'stale' | 'refreshing';

export type AccountPlanGenerationMode =
  | 'single_account'
  | 'bulk_refresh'
  | 'scheduled_refresh'
  | 'manual_refresh';

export type AccountPlanCollectorName =
  | 'salesforce'
  | 'cse_sentiment'
  | 'cerebro_support'
  | 'cerebro_usage'
  | 'glean'
  | 'slack';

export type CollectorRunStatus = 'success' | 'partial' | 'failed' | 'skipped';

export interface AccountPlanCollectorRun {
  collector: AccountPlanCollectorName;
  status: CollectorRunStatus;
  collectedAt: string;
  signalCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export type AccountPlanSignalCategory =
  | 'salesforce'
  | 'commercial'
  | 'renewal'
  | 'opportunity'
  | 'cse'
  | 'cerebro_support'
  | 'cerebro_usage'
  | 'glean'
  | 'slack'
  | 'relationship'
  | 'product'
  | 'other';

export type AccountPlanSignalSourceSystem =
  | 'salesforce'
  | 'mdas'
  | 'cse_sentiment'
  | 'cerebro'
  | 'glean'
  | 'slack';

export type SignalFreshness = 'fresh' | 'stale' | 'unknown';
export type SignalConfidence = 'high' | 'medium' | 'low';

export interface AccountPlanSignal {
  id: string;
  accountId: string;
  category: AccountPlanSignalCategory;
  label: string;
  value: string | number | boolean | null;
  observedAt?: string;
  sourceSystem: AccountPlanSignalSourceSystem;
  sourceRecordId?: string;
  sourceUrl?: string;
  freshness: SignalFreshness;
  confidence: SignalConfidence;
}

export interface AccountPlanFinding {
  title: string;
  detail: string;
  confidence: SignalConfidence;
  impact: 'high' | 'medium' | 'low';
  sourceSignalIds: string[];
}

export type AccountPlanOwnerRole =
  | 'AE'
  | 'CSE'
  | 'Renewals'
  | 'Support'
  | 'Product'
  | 'Leadership'
  | 'Unknown';

export interface AccountPlanAction {
  action: string;
  ownerRole: AccountPlanOwnerRole;
  rationale: string;
  dueDate?: string;
  priority: 'high' | 'medium' | 'low';
  sourceSignalIds: string[];
}

export type RenewalOutlook = 'positive' | 'neutral' | 'at_risk' | 'unknown';
export type ExpansionPotential = 'high' | 'medium' | 'low' | 'unknown';
export type PlanConfidence = 'high' | 'medium' | 'low';
export type SupportRiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface AccountPlan {
  accountId: string;
  generatedAt: string;
  summary: {
    headline: string;
    renewalOutlook: RenewalOutlook;
    expansionPotential: ExpansionPotential;
    confidence: PlanConfidence;
    executiveSummary: string;
  };
  renewal: {
    renewalDate?: string;
    fiscalPeriod?: string;
    stage?: string;
    availableToRenew?: number;
    currentAcv?: number;
    acvDelta?: number;
    forecastMostLikely?: number;
    renewalStatus?: string;
    churnOrDownsellReason?: string;
    assessment: string;
    risks: AccountPlanFinding[];
  };
  expansion: {
    hypotheses: AccountPlanFinding[];
    recommendedProductsOrPlays: AccountPlanFinding[];
    blockers: AccountPlanFinding[];
  };
  supportAndRisk: {
    overallRisk: SupportRiskLevel;
    findings: AccountPlanFinding[];
    openQuestions: string[];
  };
  productUsage: {
    usageAssessment: string;
    expansionSignals: AccountPlanFinding[];
    riskSignals: AccountPlanFinding[];
  };
  customerHealth: {
    cseSentiment?: string;
    cseCommentary?: string;
    healthAssessment: string;
    findings: AccountPlanFinding[];
  };
  relationshipAndEngagement: {
    assessment: string;
    findings: AccountPlanFinding[];
    openQuestions: string[];
  };
  actionPlan: AccountPlanAction[];
  evidence: AccountPlanSignal[];
  dataQuality: {
    missingSignals: string[];
    staleSignals: string[];
    conflictingSignals: string[];
    lowConfidenceSignals: string[];
    collectorFailures: string[];
    notes: string[];
  };
}

export interface PersistedAccountPlan {
  id: string;
  accountId: string;
  accountName?: string;
  franchise: AccountPlanFranchise;
  status: AccountPlanStatus;
  schemaVersion: string;
  generatedAt: string;
  generatedBy?: string;
  generationMode: AccountPlanGenerationMode;
  sourceSnapshot: {
    collectedAt: string;
    collectors: AccountPlanCollectorRun[];
    signalIds: string[];
  };
  plan: AccountPlan;
  errorMetadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectorInput {
  view: AccountView;
  now: number;
  /** Optional live Cerebro intel from account drill-down API. */
  cerebroIntel?: {
    ok: boolean;
    summary?: {
      headline: string | null;
      risksAndConcerns: string[];
      suggestedFocus: string[];
      asOfDate: string | null;
    };
    engagement?: {
      level: string;
      totalEvents: number;
      latestEngagementDate: string | null;
    };
  } | null;
  /** Glean-derived account context (compact references, not raw blobs). */
  gleanContext?: {
    planLinks: { title: string; url: string; lastModified: string }[];
    knowledgeSnippets: { title: string; url: string; snippet: string; observedAt: string }[];
  } | null;
  /** Slack engagement signals (channel mapping + indexed mentions). */
  slackContext?: {
    channelUrl: string | null;
    channelMapped: boolean;
    recentMentions: { title: string; url: string; observedAt: string; snippet: string }[];
  } | null;
}

export interface CollectorOutput {
  run: AccountPlanCollectorRun;
  signals: AccountPlanSignal[];
}

export interface GenerateAccountPlanInput {
  view: AccountView;
  collectorOutputs: CollectorOutput[];
  now?: number;
  generatedBy?: string;
  generationMode: AccountPlanGenerationMode;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  code?: 'not_found' | 'not_expand3' | 'inactive_expand3';
}
