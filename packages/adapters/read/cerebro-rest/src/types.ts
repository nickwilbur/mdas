// Typed shapes for Cerebro REST responses (subset; full spec at /docs when authed).

export interface CerebroWhoAmI {
  email?: string;
  scopes?: string[];
  clientId?: string;
}

export interface CerebroGuideResponse {
  guide?: string | Record<string, unknown>;
  version?: string;
}

export interface CerebroAccountRef {
  salesforceAccountId?: string;
  accountName?: string;
  accountType?: string;
}

export interface CerebroCustomerRisks {
  riskCategory?: string | null;
  riskAnalysis?: string | null;
  riskCategoryRationale?: string | null;
  asOfDate?: string;
}

export interface CerebroHealthRiskSignal {
  name: string;
  atRisk?: boolean | null;
  details?: string | null;
}

export interface CerebroCustomerState {
  risks?: CerebroCustomerRisks | null;
  healthRisks?: CerebroHealthRiskSignal[] | null;
  asOfDate?: string;
}

export interface CerebroAccountSummary {
  headline?: string | null;
  whatChanged?: string[];
  suggestedFocus?: string[];
  risksAndConcerns?: string[];
  asOfDate?: string;
}

export interface CerebroTeamMemberUser {
  name?: string;
  email?: string;
}

export interface CerebroTeamMemberEntry {
  user?: CerebroTeamMemberUser;
  role?: string;
}

export interface CerebroAccountTeam {
  members?: CerebroTeamMemberEntry[];
  asOfDate?: string;
}

export interface CerebroAccountDetails {
  account?: CerebroAccountRef;
  team?: CerebroAccountTeam | null;
  summary?: CerebroAccountSummary | null;
  customerState?: CerebroCustomerState | null;
  asOfDate?: string;
}

export interface CerebroAccountDetailsBatch {
  items: CerebroAccountDetails[];
  notFound: string[];
}

export interface CerebroEngagementTypeSummary {
  engagementType?: string;
  eventCount?: number;
  totalScore?: number;
  averageScore?: number;
  latestEngagementDate?: string | null;
}

export interface CerebroEngagementEvent {
  engagementDate?: string;
  engagementType?: string;
  score?: number;
  scoreReasons?: string[];
}

export interface CerebroAccountEngagementSummary {
  salesforceAccountId?: string;
  accountName?: string;
  daysBack?: number;
  totalEvents?: number;
  totalScore?: number;
  averageScore?: number;
  latestEngagementDate?: string | null;
  engagementLevel?: string;
  topEngagementTypes?: CerebroEngagementTypeSummary[];
  recentEvents?: CerebroEngagementEvent[];
}

/** Flat legacy health-risk payload (Glean-style field names). */
export interface CerebroHealthRiskRecord {
  crSalesforceAccountId?: string;
  crCustomerName?: string;
  crRiskCategory?: string;
  crRiskAnalysis?: string;
  riskCategory?: string;
  riskAnalysis?: string;
  crEngagementRisk?: boolean | string;
  crExpertiseRisk?: boolean | string;
  crLegacyTechRisk?: boolean | string;
  crPricingRisk?: boolean | string;
  crShareRisk?: boolean | string;
  crSuiteRisk?: boolean | string;
  crUtilizationRisk?: boolean | string;
  crProjectedBillingUtilization?: number;
  crProjectedRevenueUtilization?: number;
  crExecutiveMeetingCount?: number;
  crBillingProductShare?: number;
  crRevenueProductShare?: number;
  crOrdersApiUsage?: number;
  crEmailedInvoices?: number;
  crEpaymentsProcessed?: number;
  crInvoicesPosted?: number;
  crJournalEntries?: number;
  crOrders?: number;
  crQuotes?: number;
  crRevenueAmount?: number;
  crBillingCost?: number;
  crRevenueCost?: number;
  crDso?: number;
  crHasEnhancedServices?: boolean | string;
  crHasEsa?: boolean | string;
  crHasInvoiceSettlement?: boolean | string;
  crHasMs?: boolean | string;
  crHasPes?: boolean | string;
  crHasTam?: boolean | string;
  crHasUno?: boolean | string;
  crReportingUse?: boolean | string;
  updatedAt?: string;
  updateTime?: string;
  url?: string;
  [key: string]: unknown;
}

export type CerebroCapabilityKind =
  | 'search'
  | 'lookup'
  | 'list'
  | 'schemaDiscovery'
  | 'relationshipGraph'
  | 'timeline'
  | 'readOnlyTools'
  | 'writeActions'
  | 'sync'
  | 'webhook'
  | 'streaming'
  | 'aiToolInvocation';

export interface CerebroCapability {
  id: string;
  kind: CerebroCapabilityKind;
  transport: 'rest' | 'mcp';
  description: string;
  readOnly: boolean;
}

export interface CerebroRequestMeta {
  status: number;
  requestId?: string;
  durationMs: number;
}

export class CerebroApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CerebroApiError';
  }
}
