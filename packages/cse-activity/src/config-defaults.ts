import type { CseActivityConfig } from './types.js';

export const DEFAULT_CSE_ACTIVITY_CONFIG: CseActivityConfig = {
  managerName: 'CSE Manager',
  managerEmail: '',
  /** Populated at runtime from Expand 3 account assignedCSE — not configured manually */
  teamMembers: [],
  strategicAccountIds: [],
  expand3AccountIds: [],
  renewalRiskAccountIds: [],
  atrRelevantAccountIds: [],
  executiveSponsorMappings: {},
  prioritySlackChannels: ['expand3-risk-signals'],
  customerSlackChannels: [],
  internalCseChannels: ['expand3-cse'],
  excludedSlackChannels: [],
  analyzePrivateSlackDms: false,
  timezone: 'America/Denver',
  fridayEodTime: '17:00',
  snapshotOutputDir: 'reports/cse_activity_snapshots',
  individualReportOutputDir: 'team_member_reports',
  autoDeliverReports: false,
  enablePdfExport: true,
};

export function mergeConfig(partial: Partial<CseActivityConfig>): CseActivityConfig {
  return {
    ...DEFAULT_CSE_ACTIVITY_CONFIG,
    ...partial,
    teamMembers: [],
    strategicAccountIds:
      partial.strategicAccountIds ?? DEFAULT_CSE_ACTIVITY_CONFIG.strategicAccountIds,
    expand3AccountIds: partial.expand3AccountIds ?? DEFAULT_CSE_ACTIVITY_CONFIG.expand3AccountIds,
    renewalRiskAccountIds:
      partial.renewalRiskAccountIds ?? DEFAULT_CSE_ACTIVITY_CONFIG.renewalRiskAccountIds,
    atrRelevantAccountIds:
      partial.atrRelevantAccountIds ?? DEFAULT_CSE_ACTIVITY_CONFIG.atrRelevantAccountIds,
    executiveSponsorMappings:
      partial.executiveSponsorMappings ?? DEFAULT_CSE_ACTIVITY_CONFIG.executiveSponsorMappings,
    prioritySlackChannels:
      partial.prioritySlackChannels ?? DEFAULT_CSE_ACTIVITY_CONFIG.prioritySlackChannels,
    customerSlackChannels:
      partial.customerSlackChannels ?? DEFAULT_CSE_ACTIVITY_CONFIG.customerSlackChannels,
    internalCseChannels:
      partial.internalCseChannels ?? DEFAULT_CSE_ACTIVITY_CONFIG.internalCseChannels,
    excludedSlackChannels:
      partial.excludedSlackChannels ?? DEFAULT_CSE_ACTIVITY_CONFIG.excludedSlackChannels,
  };
}
