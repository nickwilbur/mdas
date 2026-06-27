/** Activity categories for CSE management coaching. */
export type ActivityCategory =
  | 'customer_meeting'
  | 'executive_engagement'
  | 'renewal_risk_activity'
  | 'health_signal_review'
  | 'account_planning'
  | 'internal_strategy'
  | 'support_escalation'
  | 'customer_follow_up'
  | 'expansion_growth'
  | 'qbr_ebr_prep'
  | 'team_coaching'
  | 'cross_functional'
  | 'documentation_enablement'
  | 'ai_assisted_workflow'
  | 'administrative'
  | 'unknown';

export type StrategicAlignmentTag =
  | 'atr_retention'
  | 'expand3_portfolio'
  | 'six_to_eight_quarter_planning'
  | 'renewal_risk_prioritization'
  | 'health_signal_usage'
  | 'executive_engagement'
  | 'account_activity_visibility'
  | 'strategic_customer_engagement'
  | 'ai_adoption'
  | 'supportability'
  | 'escalation_prevention'
  | 'portfolio_operating_rhythm';

export type ActivityQualityTag =
  | 'proactive'
  | 'reactive'
  | 'customer_facing'
  | 'internal_only'
  | 'follow_up_required'
  | 'no_clear_next_step'
  | 'executive_level'
  | 'high_value_account'
  | 'at_risk_account'
  | 'missing_account_linkage'
  | 'missing_outcome'
  | 'needs_manager_coaching';

export type TrafficStatus = 'Green' | 'Yellow' | 'Red';

export type DataSourceStatus = 'success' | 'partial' | 'failed' | 'not_configured' | 'skipped';

export interface TeamMemberConfig {
  name: string;
  email: string;
  slackUserId?: string | null;
  calendarId?: string | null;
  crmOwnerId?: string | null;
  /** Salesforce user id or internal id used in MDAS assignedCSE */
  mdasCseId?: string | null;
  active?: boolean;
}

export interface CseActivityConfig {
  managerName: string;
  managerEmail: string;
  teamMembers: TeamMemberConfig[];
  strategicAccountIds: string[];
  expand3AccountIds: string[];
  renewalRiskAccountIds: string[];
  atrRelevantAccountIds: string[];
  executiveSponsorMappings: Record<string, string>;
  prioritySlackChannels: string[];
  customerSlackChannels: string[];
  internalCseChannels: string[];
  excludedSlackChannels: string[];
  analyzePrivateSlackDms: boolean;
  timezone: string;
  /** Friday EOD run time in HH:mm (24h) local to timezone */
  fridayEodTime: string;
  snapshotOutputDir: string;
  individualReportOutputDir: string;
  autoDeliverReports: boolean;
  enablePdfExport: boolean;
}

export interface ReportingWindow {
  snapshotDate: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
}

export interface NormalizedActivity {
  id: string;
  source: string;
  sourceRef?: string;
  occurredAt: string;
  teamMemberId?: string | null;
  teamMemberName?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  title: string;
  summary: string;
  category: ActivityCategory;
  strategicTags: StrategicAlignmentTag[];
  qualityTags: ActivityQualityTag[];
  customerFacing: boolean;
  evidenceLevel: 'direct' | 'inferred' | 'metadata_only';
}

export interface SourceCoverage {
  source: string;
  status: DataSourceStatus;
  notes: string;
  impactOfGap: string;
  recordsFound: number;
}

export interface TeamMemberWeekMetrics {
  teamMemberId: string;
  teamMemberName: string;
  customerFacingCount: number;
  strategicInternalCount: number;
  highValueAccountsTouched: number;
  renewalRisksTouched: number;
  executiveEngagementCount: number;
  aiUsageSignal: string;
  managerNote: string;
  dataAvailable: boolean;
}

export interface AccountWeekMetrics {
  accountId: string;
  accountName: string;
  ownerName: string | null;
  healthRiskSignal: string;
  activityThisWeek: string;
  strategicMotion: string;
  gapConcern: string;
  recommendedManagerAction: string;
  customerFacing: boolean;
  internalOnly: boolean;
  atrUsd: number;
  bucket: string;
}

export interface DerivedWeekMetrics {
  highValueRenewalRisksWithActivity: number;
  highValueRenewalRisksWithoutActivity: number;
  accountsWithExecutiveEngagement: number;
  accountsWithCustomerFacingActivity: number;
  accountsInternalOnly: number;
  accountsStaleNextSteps: number;
  healthSignalsReviewed: number;
  healthSignalsActedOn: number;
  teamMembersUsingAi: number;
  aiArtifactsCreated: number;
  followUpsCreatedOrCompleted: number;
  accountPlansUpdated: number;
}

export interface SnapshotMetadata {
  generatedAt: string;
  reportingWindowStart: string;
  reportingWindowEnd: string;
  timezone: string;
  snapshotDate: string;
  dataSourcesAttempted: string[];
  dataSourcesSuccessful: string[];
  dataSourcesFailed: string[];
  teamMembersIncluded: string[];
  accountsIncluded: string[];
  knownDataGaps: string[];
  immutable: boolean;
  derivedMetrics: DerivedWeekMetrics;
  overallStatus: TrafficStatus;
  strategicPosture: string;
  confidenceLevel: 'High' | 'Medium' | 'Low';
  dataCoverage: 'Strong' | 'Partial' | 'Weak';
  /** Roster inferred from Expand 3 assignedCSE at snapshot time */
  teamMemberConfigs?: TeamMemberConfig[];
  /** Persisted for regeneration without recomputing from raw activity */
  teamMetrics?: TeamMemberWeekMetrics[];
  accountMetrics?: AccountWeekMetrics[];
  sourceCoverage?: SourceCoverage[];
}

export interface WeeklySnapshot {
  metadata: SnapshotMetadata;
  teamActivity: NormalizedActivity[];
  accountActivity: NormalizedActivity[];
  teamMetrics: TeamMemberWeekMetrics[];
  accountMetrics: AccountWeekMetrics[];
  sourceCoverage: SourceCoverage[];
  calendarActivity: unknown[];
  slackActivity: unknown[];
  crmActivity: unknown[];
  renewalRiskActivity: unknown[];
  aiEnablementActivity: unknown[];
}

export interface WeekOverWeekComparison {
  currentSnapshotDate: string;
  priorSnapshotDate: string | null;
  deltas: Partial<DerivedWeekMetrics>;
  narrative: string[];
}
