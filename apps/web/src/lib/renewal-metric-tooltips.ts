/** Metric definitions for renewal pipeline and quarter-close views. */

export const RENEWAL_METRIC_HINTS = {
  pipelineAtr:
    'Total Available to Renew on open renewal opportunities in scope. Use this to size the book you are actively managing forward.',
  openRenewals:
    'Accounts with at least one open renewal (not yet closed). These are your proactive management queue.',
  pushedRenewals:
    'Open renewals past their close date — slipped deals that need immediate attention.',
  atRiskPipeline:
    'Open renewals with Cerebro Overall Assessment Critical or High in the selected quarters. Uses the synced Cerebro category, not composite fallback scores.',
  renewalsNext30Days:
    'Open renewals with a close date in the next 30 calendar days (within the selected quarter scope). Time-based urgency, separate from Cerebro risk band.',
  knownChurn:
    'Renewal opps with SFDC Churn Risk = Confirmed Full Churn. Tracked separately from saveable pipeline metrics.',
  atrUp:
    'Sum of Available to Renew on saveable renewal opps in scope. Excludes confirmed full churn.',
  renewed:
    'Derived post-renewal dollars: closed-won ACV or ATR + ACV delta; open renewals use manager ML override as a signed delta on ATR.',
  atrChurned:
    'ATR on accounts classified as full churn (renewed revenue = 0). Quarter-close metric only.',
  fullChurnRate:
    'Fully churned accounts ÷ accounts with renewal ATR in scope. Counts closed-lost saveable renewals after quarter close. SFDC Confirmed Full Churn opps are tracked separately in Known churn.',
  downsellRate:
    'Accounts where renewed revenue > 0 but < ATR, divided by accounts up for renewal.',
  grr: 'Gross revenue retention: total derived renewed revenue ÷ total ATR up for renewal.',
  overallAssessment:
    'Cerebro Overall Assessment category from Glean/Cerebro health indexing. Hover for the narrative assessment and contributing risk signals.',
  overallAssessmentBreakdown:
    'Renewal opportunities grouped by synced Cerebro Overall Assessment category. Open opps only by default; use Show closed to include closed renewals in the chart and pipeline table.',
  pipelineStatusBreakdown:
    'Open renewals grouped by pipeline status. Known churn (SFDC Confirmed Full Churn) is shown separately from forecast full churn and closed full churn. Click a segment to filter the table.',
  daysSinceSlackUpdate:
    'Days since the last real-person post in the mapped internal customer Slack channel (excludes bot joins and app notifications). Blank when no human Slack activity is indexed.',
  daysSinceCustomerEngagement:
    'Days since the most recent documented customer touch — email, logged call, meeting, conference, or workshop. Excludes Slack, marketing mail, and CSE sentiment field updates.',
  outcomeBreakdown:
    'Final renewal outcomes for closed deals only. Open renewals do not have an outcome until they close.',
  churnReasons:
    'Top churn reasons recorded in SFDC after renewals close. Review at quarter-end, not for forward pipeline management.',
  downsellReasons:
    'Top downsell reasons recorded in SFDC after partial renewals close. Review at quarter-end.',
} as const;

/** Tooltips for the executive renewal dashboard (`/renewals`). */
export const RENEWAL_DASHBOARD_HINTS = {
  grr: RENEWAL_METRIC_HINTS.grr,
  planVsFlash:
    'Compares Churn/Downsell Flash to your saved quarterly plan (same numbers as the weekly forecast). Flash below plan is favorable.',
  atrUp: RENEWAL_METRIC_HINTS.atrUp,
  atrChurned: RENEWAL_METRIC_HINTS.atrChurned,
  logoChurn: RENEWAL_METRIC_HINTS.fullChurnRate,
  downsellExposure:
    'Total ATR not retained on partial renewals (renewed > 0 but < ATR), plus account count and downsell rate.',
  knownChurn: RENEWAL_METRIC_HINTS.knownChurn,
  retentionTrend:
    'Gross renewal retention and ATR/renewed dollars for the last 8 quarters. Each quarter is evaluated as-of its close (or today for the open quarter).',
  outcomeMix: RENEWAL_METRIC_HINTS.outcomeBreakdown,
  revenueBridge:
    'How starting ATR flows through full churn, downsell, expansion, and ending renewed revenue for the selected period.',
  portfolioSnapshot:
    'Side-by-side view of total ATR up for renewal versus renewed, churned, and downsell dollars in scope.',
  attentionAccounts:
    'Highest-ATR accounts with full churn, pushed, downsell, or still-open renewals. Opportunity links open the in-app Opportunities view; sort any column.',
  upcomingAtr:
    'Open renewal pipeline ATR grouped by days until close. Hover each bucket to see accounts with ATR, most-likely forecast, risk, sentiment, and renewal date.',
} as const;
