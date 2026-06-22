import type { CanonicalOpportunity } from '@mdas/canonical';
import { nextFutureRenewalOpp } from '@mdas/cta-engine';
import type { AccountView } from '@mdas/canonical';
import type { CollectorInput, CollectorOutput } from '../types.js';
import {
  classifyFreshness,
  confidenceFromFreshness,
  signalId,
  stripHtml,
  truncate,
} from '../utils.js';

function openExpansionOpps(opps: CanonicalOpportunity[]): CanonicalOpportunity[] {
  const closed = /^(closed|won|lost|dead|churn)/i;
  return opps.filter((o) => {
    if (/renewal/i.test(o.type)) return false;
    if (closed.test(o.stageName ?? '')) return false;
    return true;
  });
}

export function collectSalesforceSignals(input: CollectorInput): CollectorOutput {
  const { view, now } = input;
  const a = view.account;
  const collectedAt = new Date(now).toISOString();
  const signals = [];
  const renewal = nextFutureRenewalOpp(view, now);

  const push = (
    key: string,
    label: string,
    value: string | number | boolean | null,
    category: 'salesforce' | 'commercial' | 'renewal' | 'opportunity',
    observedAt?: string,
  ) => {
    const freshness = classifyFreshness(observedAt ?? a.lastUpdated, now);
    signals.push({
      id: signalId('sf', key),
      accountId: a.accountId,
      category,
      label,
      value,
      observedAt: observedAt ?? a.lastUpdated,
      sourceSystem: 'salesforce' as const,
      sourceRecordId: a.salesforceAccountId,
      freshness,
      confidence: confidenceFromFreshness(freshness, 'high'),
    });
  };

  push('account_name', 'Account name', a.accountName, 'salesforce');
  push('account_owner', 'Account owner', a.accountOwner?.name ?? null, 'salesforce');
  push('assigned_cse', 'Assigned CSE', a.assignedCSE?.name ?? null, 'salesforce');
  push('franchise', 'Franchise', a.franchise, 'salesforce');
  push('all_time_arr', 'All-time ARR (USD)', a.allTimeARR, 'commercial');
  push('active_product_lines', 'Active product lines', a.activeProductLines.join(', ') || null, 'commercial');
  push('customer_status', 'Customer status', a.customerStatus ?? null, 'salesforce');
  push('churn_reason', 'Churn reason', a.churnReason ?? null, 'renewal');

  if (renewal) {
    push('renewal_close_date', 'Renewal close date', renewal.closeDate, 'renewal', renewal.lastUpdated);
    push('renewal_stage', 'Renewal stage', renewal.stageName, 'renewal', renewal.lastUpdated);
    push('available_to_renew', 'Available to renew (USD)', renewal.availableToRenewUSD, 'renewal', renewal.lastUpdated);
    push('renewal_acv', 'Renewal ACV (USD)', renewal.acv, 'renewal', renewal.lastUpdated);
    push('acv_delta', 'ACV delta (USD)', renewal.acvDelta, 'renewal', renewal.lastUpdated);
    push('forecast_most_likely', 'Forecast most likely (USD)', renewal.forecastMostLikely, 'renewal', renewal.lastUpdated);
    push('forecast_category', 'Forecast category', renewal.forecastCategory ?? null, 'renewal', renewal.lastUpdated);
    push('churn_downsell_reason', 'Churn/downsell reason', renewal.churnDownsellReason ?? null, 'renewal', renewal.lastUpdated);
    push('churn_risk', 'Churn risk', renewal.churnRisk ?? null, 'renewal', renewal.lastUpdated);
  }

  for (const opp of openExpansionOpps(view.opportunities).slice(0, 5)) {
    push(
      `opp_${opp.opportunityId}_stage`,
      `Expansion opp stage: ${opp.opportunityName}`,
      opp.stageName,
      'opportunity',
      opp.lastUpdated,
    );
  }

  if (view.daysToRenewal != null) {
    push('days_to_renewal', 'Days to renewal', view.daysToRenewal, 'renewal');
  }

  return {
    run: {
      collector: 'salesforce',
      status: 'success',
      collectedAt,
      signalCount: signals.length,
    },
    signals,
  };
}

export function collectCseSentimentSignals(input: CollectorInput): CollectorOutput {
  const { view, now } = input;
  const a = view.account;
  const collectedAt = new Date(now).toISOString();
  const signals = [];

  const commentaryFreshness = classifyFreshness(a.cseSentimentCommentaryLastUpdated, now);
  const sentimentFreshness = classifyFreshness(a.cseSentimentLastUpdated, now);

  signals.push({
    id: signalId('cse', 'sentiment'),
    accountId: a.accountId,
    category: 'cse',
    label: 'CSE sentiment',
    value: a.cseSentiment,
    observedAt: a.cseSentimentLastUpdated ?? undefined,
    sourceSystem: 'cse_sentiment',
    sourceRecordId: a.salesforceAccountId,
    freshness: sentimentFreshness,
    confidence: confidenceFromFreshness(sentimentFreshness, 'high'),
  });

  const commentary = stripHtml(a.cseSentimentCommentary);
  if (commentary) {
    signals.push({
      id: signalId('cse', 'commentary'),
      accountId: a.accountId,
      category: 'cse',
      label: 'CSE sentiment commentary',
      value: truncate(commentary, 500),
      observedAt: a.cseSentimentCommentaryLastUpdated ?? undefined,
      sourceSystem: 'cse_sentiment',
      sourceRecordId: a.salesforceAccountId,
      freshness: commentaryFreshness,
      confidence: confidenceFromFreshness(commentaryFreshness, 'high'),
    });
  }

  signals.push({
    id: signalId('cse', 'cs_coverage'),
    accountId: a.accountId,
    category: 'cse',
    label: 'CS coverage model',
    value: a.csCoverage,
    observedAt: a.lastUpdated,
    sourceSystem: 'mdas',
    freshness: classifyFreshness(a.lastUpdated, now),
    confidence: 'high',
  });

  return {
    run: {
      collector: 'cse_sentiment',
      status: commentary || a.cseSentiment ? 'success' : 'partial',
      collectedAt,
      signalCount: signals.length,
      ...(commentary || a.cseSentiment
        ? {}
        : { errorCode: 'missing_cse_data', errorMessage: 'No CSE sentiment or commentary on record' }),
    },
    signals,
  };
}

export function collectCerebroSupportSignals(input: CollectorInput): CollectorOutput {
  const { view, now, cerebroIntel } = input;
  const a = view.account;
  const collectedAt = new Date(now).toISOString();
  const signals = [];
  let status: CollectorOutput['run']['status'] = 'success';

  const cerebroFreshness = classifyFreshness(a.lastFetchedFromSource?.cerebro, now);

  signals.push({
    id: signalId('cerebro', 'risk_category'),
    accountId: a.accountId,
    category: 'cerebro_support',
    label: 'Cerebro risk category',
    value: a.cerebroRiskCategory,
    observedAt: a.lastFetchedFromSource?.cerebro ?? a.lastUpdated,
    sourceSystem: 'cerebro',
    freshness: cerebroFreshness,
    confidence: confidenceFromFreshness(cerebroFreshness, 'high'),
  });

  if (a.cerebroRiskAnalysis) {
    signals.push({
      id: signalId('cerebro', 'risk_analysis'),
      accountId: a.accountId,
      category: 'cerebro_support',
      label: 'Cerebro risk analysis',
      value: truncate(a.cerebroRiskAnalysis, 400),
      observedAt: a.lastFetchedFromSource?.cerebro ?? a.lastUpdated,
      sourceSystem: 'cerebro',
      freshness: cerebroFreshness,
      confidence: confidenceFromFreshness(cerebroFreshness, 'medium'),
    });
  }

  const riskFlags = Object.entries(a.cerebroRisks ?? {}).filter(([, v]) => v === true);
  for (const [key] of riskFlags) {
    signals.push({
      id: signalId('cerebro', `risk_flag_${key}`),
      accountId: a.accountId,
      category: 'cerebro_support',
      label: `Cerebro risk flag: ${key}`,
      value: true,
      observedAt: a.lastFetchedFromSource?.cerebro ?? a.lastUpdated,
      sourceSystem: 'cerebro',
      freshness: cerebroFreshness,
      confidence: 'high',
    });
  }

  if (cerebroIntel?.summary) {
    const intelFreshness = classifyFreshness(cerebroIntel.summary.asOfDate, now);
    if (cerebroIntel.summary.headline) {
      signals.push({
        id: signalId('cerebro', 'live_headline'),
        accountId: a.accountId,
        category: 'cerebro_support',
        label: 'Cerebro live summary headline',
        value: cerebroIntel.summary.headline,
        observedAt: cerebroIntel.summary.asOfDate ?? undefined,
        sourceSystem: 'cerebro',
        freshness: intelFreshness,
        confidence: confidenceFromFreshness(intelFreshness, 'medium'),
      });
    }
    for (const [i, concern] of (cerebroIntel.summary.risksAndConcerns ?? []).slice(0, 5).entries()) {
      signals.push({
        id: signalId('cerebro', `live_concern_${i}`),
        accountId: a.accountId,
        category: 'cerebro_support',
        label: 'Cerebro live concern',
        value: truncate(concern, 200),
        observedAt: cerebroIntel.summary.asOfDate ?? undefined,
        sourceSystem: 'cerebro',
        freshness: intelFreshness,
        confidence: 'medium',
      });
    }
  } else if (a.sourceErrors?.cerebro) {
    status = 'partial';
  }

  if (!a.cerebroRiskCategory && riskFlags.length === 0 && !cerebroIntel?.ok) {
    status = a.sourceErrors?.cerebro ? 'failed' : 'partial';
  }

  return {
    run: {
      collector: 'cerebro_support',
      status,
      collectedAt,
      signalCount: signals.length,
      ...(a.sourceErrors?.cerebro
        ? { errorCode: 'cerebro_error', errorMessage: a.sourceErrors.cerebro }
        : {}),
    },
    signals,
  };
}

export function collectCerebroUsageSignals(input: CollectorInput): CollectorOutput {
  const { view, now } = input;
  const a = view.account;
  const collectedAt = new Date(now).toISOString();
  const signals = [];
  const cerebroFreshness = classifyFreshness(a.lastFetchedFromSource?.cerebro, now);

  const subMetrics = a.cerebroSubMetrics ?? {};
  for (const [key, raw] of Object.entries(subMetrics)) {
    if (raw === null || raw === undefined || raw === '') continue;
    signals.push({
      id: signalId('usage', key),
      accountId: a.accountId,
      category: 'cerebro_usage',
      label: `Product usage: ${key}`,
      value: typeof raw === 'boolean' ? raw : String(raw),
      observedAt: a.lastFetchedFromSource?.cerebro ?? a.lastUpdated,
      sourceSystem: 'cerebro',
      freshness: cerebroFreshness,
      confidence: confidenceFromFreshness(cerebroFreshness, 'medium'),
    });
  }

  if (a.engagementMinutes30d != null) {
    signals.push({
      id: signalId('usage', 'engagement_30d'),
      accountId: a.accountId,
      category: 'cerebro_usage',
      label: 'Engagement minutes (30d)',
      value: a.engagementMinutes30d,
      observedAt: a.lastFetchedFromSource?.salesforce ?? a.lastUpdated,
      sourceSystem: 'salesforce',
      freshness: classifyFreshness(a.lastFetchedFromSource?.salesforce, now),
      confidence: 'high',
    });
  }

  if (a.engagementMinutes90d != null) {
    signals.push({
      id: signalId('usage', 'engagement_90d'),
      accountId: a.accountId,
      category: 'cerebro_usage',
      label: 'Engagement minutes (90d)',
      value: a.engagementMinutes90d,
      observedAt: a.lastFetchedFromSource?.salesforce ?? a.lastUpdated,
      sourceSystem: 'salesforce',
      freshness: classifyFreshness(a.lastFetchedFromSource?.salesforce, now),
      confidence: 'high',
    });
  }

  const utilizationRisk = a.cerebroRisks?.utilizationRisk;
  if (utilizationRisk != null) {
    signals.push({
      id: signalId('usage', 'utilization_risk'),
      accountId: a.accountId,
      category: 'cerebro_usage',
      label: 'Utilization risk flag',
      value: utilizationRisk,
      observedAt: a.lastFetchedFromSource?.cerebro ?? a.lastUpdated,
      sourceSystem: 'cerebro',
      freshness: cerebroFreshness,
      confidence: 'high',
    });
  }

  const status =
    signals.length > 0 ? 'success' : a.sourceErrors?.cerebro ? 'failed' : 'partial';

  return {
    run: {
      collector: 'cerebro_usage',
      status,
      collectedAt,
      signalCount: signals.length,
      ...(signals.length === 0
        ? { errorCode: 'missing_usage', errorMessage: 'No product usage metrics available' }
        : {}),
    },
    signals,
  };
}

export function collectGleanSignals(input: CollectorInput): CollectorOutput {
  const { view, now, gleanContext } = input;
  const a = view.account;
  const collectedAt = new Date(now).toISOString();
  const signals = [];

  const localLinks = a.accountPlanLinks ?? [];
  for (const [i, link] of localLinks.slice(0, 5).entries()) {
    const freshness = classifyFreshness(link.lastModified, now, 24 * 7);
    signals.push({
      id: signalId('glean', `local_plan_${i}`),
      accountId: a.accountId,
      category: 'glean',
      label: 'Account plan document (indexed)',
      value: link.title,
      observedAt: link.lastModified,
      sourceSystem: 'glean',
      sourceUrl: link.url,
      freshness,
      confidence: confidenceFromFreshness(freshness, 'medium'),
    });
  }

  for (const [i, snippet] of (gleanContext?.knowledgeSnippets ?? []).slice(0, 5).entries()) {
    const freshness = classifyFreshness(snippet.observedAt, now);
    signals.push({
      id: signalId('glean', `live_snippet_${i}`),
      accountId: a.accountId,
      category: 'glean',
      label: snippet.title,
      value: truncate(snippet.snippet, 200),
      observedAt: snippet.observedAt,
      sourceSystem: 'glean',
      sourceUrl: snippet.url,
      freshness,
      confidence: 'low',
    });
  }

  const status =
    signals.length > 0
      ? gleanContext?.knowledgeSnippets?.length || localLinks.length
        ? 'success'
        : 'partial'
      : 'skipped';

  return {
    run: {
      collector: 'glean',
      status,
      collectedAt,
      signalCount: signals.length,
      ...(status === 'skipped'
        ? { errorCode: 'glean_unavailable', errorMessage: 'No Glean account knowledge available' }
        : {}),
    },
    signals,
  };
}

export function collectSlackSignals(input: CollectorInput): CollectorOutput {
  const { view, now, slackContext } = input;
  const a = view.account;
  const collectedAt = new Date(now).toISOString();
  const signals = [];

  const channelUrl = slackContext?.channelUrl ?? a.salesforceSlackChannelUrl ?? null;
  if (channelUrl) {
    signals.push({
      id: signalId('slack', 'channel_url'),
      accountId: a.accountId,
      category: 'slack',
      label: 'Internal Slack channel',
      value: channelUrl,
      observedAt: a.lastUpdated,
      sourceSystem: 'slack',
      sourceUrl: channelUrl,
      freshness: 'fresh',
      confidence: 'high',
    });
  }

  signals.push({
    id: signalId('slack', 'channel_mapped'),
    accountId: a.accountId,
    category: 'slack',
    label: 'Slack channel mapped in MDAS',
    value: slackContext?.channelMapped ?? Boolean(channelUrl),
    observedAt: collectedAt,
    sourceSystem: 'mdas',
    freshness: 'unknown',
    confidence: 'high',
  });

  for (const [i, mention] of (slackContext?.recentMentions ?? []).slice(0, 5).entries()) {
    const freshness = classifyFreshness(mention.observedAt, now, 24 * 14);
    signals.push({
      id: signalId('slack', `mention_${i}`),
      accountId: a.accountId,
      category: 'slack',
      label: mention.title,
      value: truncate(mention.snippet, 160),
      observedAt: mention.observedAt,
      sourceSystem: 'slack',
      sourceUrl: mention.url,
      freshness,
      confidence: 'low',
    });
  }

  const status = signals.length > 1 ? 'success' : channelUrl ? 'partial' : 'skipped';

  return {
    run: {
      collector: 'slack',
      status,
      collectedAt,
      signalCount: signals.length,
      ...(status === 'skipped'
        ? { errorCode: 'slack_unavailable', errorMessage: 'No Slack channel or indexed mentions' }
        : {}),
    },
    signals,
  };
}

export function runAllLocalCollectors(input: CollectorInput): CollectorOutput[] {
  return [
    collectSalesforceSignals(input),
    collectCseSentimentSignals(input),
    collectCerebroSupportSignals(input),
    collectCerebroUsageSignals(input),
    collectGleanSignals(input),
    collectSlackSignals(input),
  ];
}
