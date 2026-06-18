import type { AccountView, CanonicalOpportunity } from '@mdas/canonical';
import type { CTAEngineConfig } from './config.js';
import type { PlayCandidate } from './rules.js';
import type { CTARecord } from './types.js';
import { dedupKey } from './suppress.js';
import { computeCtaDeadline } from './deadline.js';
import { nextFutureRenewalOpp } from './scope.js';
import { resolveCseSlackOwner } from './slack-owners.js';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function getRequestedAction(playType: string): string {
  switch (playType) {
    case 'churn_retro':
    case 'confirmed_churn_retro':
      return 'Conduct churn retro — document reasons and learnings.';
    case 'managed_wind_down':
      return 'Manage wind-down timeline and ensure clean exit.';
    case 'utilization_risk':
      return 'Investigate usage patterns and build remediation plan.';
    case 'dark_account':
      return 'Investigate account status and re-engage.';
    case 'dark_renewal':
      return 'Re-engage ahead of upcoming renewal.';
    case 'no_strategic_engagement':
      return 'Establish strategic engagement cadence.';
    case 'surprise_churn_watch':
      return 'Monitor closely — Yellow sentiment with approaching renewal.';
    case 'engagement_risk':
      return 'Reconnect on engagement — validate champion and exec touchpoints.';
    case 'sentiment_stale':
      return 'Update CSE sentiment commentary with current state and action plan.';
    case 'data_quality_gap':
      return 'Validate account mapping and refresh missing telemetry before renewal planning.';
    case 'suite_risk':
    case 'share_risk':
    case 'legacy_tech_risk':
    case 'pricing_risk':
    case 'expertise_risk':
      return 'Review Cerebro risk signals and build remediation plan.';
    default:
      return 'Review and update SFDC.';
  }
}

function riskColorFromView(view: AccountView, playType: string): string {
  const sentiment = view.account.cseSentiment;
  const days = view.daysToRenewal;

  if (playType === 'dark_account' || playType === 'dark_renewal') {
    if (days != null && days <= 30) return 'Red';
    if (days != null && days <= 90) return 'Yellow';
    if (sentiment === 'Red') return 'Red';
    if (sentiment === 'Yellow') return 'Yellow';
    return 'Green';
  }

  if (sentiment === 'Red') return 'Red';
  if (sentiment === 'Yellow') return 'Yellow';
  return 'Green';
}

function computeDeadline(
  view: AccountView,
  scanDate: string,
  now: number,
): { deadline: string; check_back_date: string } {
  return computeCtaDeadline(view, scanDate, now);
}

function renewalOppForCta(view: AccountView, now: number): CanonicalOpportunity | null {
  return nextFutureRenewalOpp(view, now);
}

function renewalOppUrl(
  view: AccountView,
  opp: CanonicalOpportunity | null,
): string | null {
  if (opp?.sourceLinks) {
    const sf = opp.sourceLinks.find((l) => l.source === 'salesforce');
    if (sf?.url) return sf.url;
  }
  const sfid = view.account.salesforceAccountId;
  if (sfid) {
    return `https://zuora.lightning.force.com/lightning/r/Account/${sfid}/view`;
  }
  return null;
}

function buildDrivers(
  view: AccountView,
  candidate: PlayCandidate,
  now: number,
): string[] {
  const drivers = [...candidate.drivers];
  const renewal = renewalOppForCta(view, now);
  if (renewal?.closeDate && !drivers.some((d) => /renewal/i.test(d))) {
    drivers.unshift(`Renewal date: ${renewal.closeDate}`);
  }
  const arr = view.account.allTimeARR;
  if (arr && !drivers.some((d) => /^arr:/i.test(d))) {
    drivers.splice(renewal ? 1 : 0, 0, `ARR: $${Math.round(arr).toLocaleString()}`);
  }
  if (view.atrUSD > 0 && !drivers.some((d) => /^atr:/i.test(d))) {
    const idx = drivers.findIndex((d) => /^arr:/i.test(d));
    const atr = `ATR at risk: $${Math.round(view.atrUSD).toLocaleString()}`;
    if (idx >= 0) drivers.splice(idx + 1, 0, atr);
    else drivers.unshift(atr);
  }
  const sentiment = view.account.cseSentiment;
  if (sentiment && !drivers.some((d) => /sentiment/i.test(d))) {
    drivers.push(`CSE Sentiment: ${sentiment}`);
  }
  return drivers;
}

export function buildCTARecord(
  view: AccountView,
  candidate: PlayCandidate,
  scanDate: string,
  config: CTAEngineConfig,
  now: number = Date.now(),
): CTARecord {
  const { account } = view;
  const aeName = account.accountOwner?.name ?? 'Unknown AE';
  const cseOwner = account.assignedCSE
    ? resolveCseSlackOwner(account.assignedCSE.id, account.assignedCSE.name)
    : null;
  const cseName = cseOwner?.name ?? null;
  const { deadline, check_back_date: checkBack } = computeDeadline(view, scanDate, now);

  const opp = renewalOppForCta(view, now);

  const data_gaps = [...candidate.data_gaps];
  if (!cseName && !data_gaps.some((g) => /cse/i.test(g))) {
    data_gaps.push('No CSE assigned (digital coverage)');
  }
  if (!account.salesforceSlackChannelUrl && !data_gaps.some((g) => /slack/i.test(g))) {
    data_gaps.push('No Slack channel confirmed');
  }

  const staleAfter = new Date(scanDate);
  staleAfter.setDate(staleAfter.getDate() + Math.floor(config.darkAccountLookbackDays / 2));

  return {
    cta_id: `expand3-${scanDate}-${slugify(account.accountName)}-${candidate.play_type}`,
    account_name: account.accountName,
    salesforce_account_id: account.salesforceAccountId,
    play_type: candidate.play_type,
    risk_color: riskColorFromView(view, candidate.play_type),
    primary_owner: cseOwner
      ? {
          name: cseOwner.name,
          role: 'CSE',
          ...(cseOwner.slack_handle ? { slack_handle: cseOwner.slack_handle } : {}),
        }
      : { name: aeName, role: 'AE' },
    cc_owners: cseName ? [{ name: aeName, role: 'AE' }] : [],
    destination_slack_channel: account.salesforceSlackChannelUrl ?? null,
    renewal_opportunity_url: renewalOppUrl(view, opp),
    drivers: buildDrivers(view, candidate, now),
    requested_action: getRequestedAction(candidate.play_type),
    deadline,
    check_back_date: checkBack,
    expected_artifact: 'SFDC update + Slack thread',
    follow_through: {
      expected_artifact: 'SFDC update + Slack thread',
      check_back_date: checkBack,
      auto_check_query: `${account.accountName} Slack OR meeting OR email last 7 days`,
      if_no_response_by: deadline,
      then: 'Escalate to CSE manager',
    },
    data_gaps,
    cse_sentiment_commentary: account.cseSentimentCommentary,
    commentary_last_updated: account.cseSentimentCommentaryLastUpdated,
    team_aware: candidate.team_aware ?? false,
    ae: { name: aeName, role: 'AE' },
    cse: cseOwner
      ? {
          name: cseOwner.name,
          role: 'CSE',
          ...(cseOwner.slack_handle ? { slack_handle: cseOwner.slack_handle } : {}),
        }
      : null,
    priority_score: candidate.priority_score,
    confidence: candidate.confidence,
    source_signals: candidate.source_signals,
    dedup_key: dedupKey(account.salesforceAccountId, candidate.play_type),
    stale_after: staleAfter.toISOString().slice(0, 10),
    atr_at_risk_usd: view.atrUSD > 0 ? view.atrUSD : null,
    renewal_opportunity_name: opp?.opportunityName ?? null,
  };
}
