import { defaultRenewalFiscalYears, FISCAL_QUARTER_FORWARD_COUNT } from './fiscal.js';

export interface CTAEngineConfig {
  /** Days without meaningful engagement to count as dark. */
  darkAccountLookbackDays: number;
  /** Minimum weighted dark-signal score to fire dark_account. */
  darkAccountMinWeight: number;
  /** Renewal opp considered stale if no next steps / activity proxy beyond this. */
  darkRenewalOppStaleDays: number;
  /** Rolling quarters for renewal-window scope. */
  renewalWindowQuarters: number;
  /** Dedup window for same account + play_type. */
  dedupWindowDays: number;
  /** Max CTAs emitted per scan (noise cap). */
  maxCtasPerScan: number;
  /** Engagio minutes below this count as low engagement. */
  lowEngagementMinutes30d: number;
  /** PBU % below this triggers utilization_risk. */
  utilizationThresholdPct: number;
  /** Commentary older than this + renewal proximity → sentiment_stale. */
  sentimentStaleDays: number;
  /** Limit evaluation to open renewals in these Zuora FYs (e.g. 2027 = FY27). Empty = all. */
  renewalFiscalYears: number[];
  /** When true, only emit CTAs for dark / identified-risk / unhealthy accounts. */
  requireRiskOrUnhealthy: boolean;
}

export const DEFAULT_CTA_CONFIG: CTAEngineConfig = {
  darkAccountLookbackDays: 90,
  darkAccountMinWeight: 2.0,
  darkRenewalOppStaleDays: 60,
  renewalWindowQuarters: FISCAL_QUARTER_FORWARD_COUNT,
  dedupWindowDays: 14,
  maxCtasPerScan: 50,
  lowEngagementMinutes30d: 10,
  utilizationThresholdPct: 65,
  sentimentStaleDays: 90,
  renewalFiscalYears: [],
  requireRiskOrUnhealthy: true,
};

export function mergeConfig(
  partial?: Partial<CTAEngineConfig>,
): CTAEngineConfig {
  const merged = { ...DEFAULT_CTA_CONFIG, ...partial };
  if (!('renewalFiscalYears' in (partial ?? {}))) {
    merged.renewalFiscalYears = defaultRenewalFiscalYears();
  }
  return merged;
}
