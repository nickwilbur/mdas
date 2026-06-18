/**
 * Expand 3 CTA types — backward-compatible with apps/web CTARecord / RichCTA.
 */

export type CTAPlayType =
  | 'surprise_churn_watch'
  | 'utilization_risk'
  | 'dark_renewal'
  | 'dark_account'
  | 'managed_wind_down'
  | 'no_strategic_engagement'
  | 'churn_retro'
  | 'confirmed_churn_retro'
  | 'scale_engagement'
  | 'expertise_risk'
  | 'engagement_risk'
  | 'pricing_risk'
  | 'suite_risk'
  | 'share_risk'
  | 'legacy_tech_risk'
  | 'sentiment_stale'
  | 'data_quality_gap';

export interface CTAOwner {
  name: string;
  slack_handle?: string;
  role: string;
}

export interface CTAFollowThrough {
  expected_artifact?: string;
  check_back_date?: string;
  auto_check_query?: string;
  escalation_owner?: string;
  escalation_trigger?: string;
  if_no_response_by?: string;
  then?: string;
}

export interface CTASourceSignal {
  source: string;
  signal: string;
  observedAt?: string;
}

export interface CTARecord {
  cta_id: string;
  account_name: string;
  salesforce_account_id: string | null;
  play_type: string;
  risk_color: string;
  primary_owner: CTAOwner | string;
  cc_owners?: CTAOwner[];
  destination_slack_channel?: string | null;
  renewal_opportunity_url?: string | null;
  drivers?: string[];
  requested_action?: string;
  deadline: string;
  check_back_date?: string;
  expected_artifact?: string;
  follow_through?: CTAFollowThrough;
  data_gaps?: string[];
  cse_sentiment_commentary?: string | null;
  commentary_last_updated?: string | null;
  team_aware?: boolean;
  ae?: { name: string; role: string } | null;
  cse?: { name: string; role: string } | null;
  situation_read?: string | null;
  point_of_view?: string | null;
  /** Additive v3 fields */
  priority_score?: number;
  confidence?: 'high' | 'medium' | 'low';
  source_signals?: CTASourceSignal[];
  dedup_key?: string;
  stale_after?: string;
  /** Available-to-renew USD on the scoped renewal opportunity. */
  atr_at_risk_usd?: number | null;
  renewal_opportunity_name?: string | null;
}

export interface CTALogEntry extends CTARecord {
  posted_at: string;
  posted_to_channel: string;
  status: string;
  last_checked_at: string | null;
  escalation_message_id: string | null;
}

export interface CTAEvaluationResult {
  cta: CTARecord | null;
  suppressed: boolean;
  suppressed_reason?: string;
  play_type_candidates: Array<{ play_type: CTAPlayType; priority_score: number }>;
}

export interface DarkSignal {
  id: string;
  label: string;
  weight: number;
  source: string;
  observedAt?: string;
  daysAgo?: number;
}

export interface DarkAccountAssessment {
  isDark: boolean;
  weightedScore: number;
  signals: DarkSignal[];
  confidence: 'high' | 'medium' | 'low';
  daysSinceLastActivity: number | null;
}
