import { nextFutureRenewalOpp } from '@mdas/cta-engine';
import { daysSinceLastActivity } from '@mdas/cta-engine';
import type {
  AccountPlan,
  AccountPlanAction,
  AccountPlanCollectorRun,
  AccountPlanSignal,
  GenerateAccountPlanInput,
} from './types.js';
import { ACCOUNT_PLAN_SCHEMA_VERSION } from './types.js';
import {
  computePlanConfidence,
  detectDataQualityIssues,
  scoreExpansionPotential,
  scoreRenewalOutlook,
  scoreSupportRisk,
} from './scoring.js';
import { stripHtml } from './utils.js';

function buildActions(
  renewalRisks: AccountPlan['renewal']['risks'],
  supportFindings: AccountPlan['supportAndRisk']['findings'],
  expansionHypotheses: AccountPlan['expansion']['hypotheses'],
  signals: AccountPlanSignal[],
): AccountPlanAction[] {
  const actions: AccountPlanAction[] = [];

  if (renewalRisks.some((r) => r.title.includes('Negative CSE sentiment'))) {
    actions.push({
      action: 'Update CSE sentiment commentary and renewal outlook in Salesforce/Gainsight',
      ownerRole: 'CSE',
      rationale: 'Sentiment is negative or stale; leadership needs an updated qualitative read.',
      priority: 'high',
      sourceSignalIds: renewalRisks.flatMap((r) => r.sourceSignalIds),
    });
  }

  if (renewalRisks.some((r) => /churn|downsell/i.test(r.title))) {
    actions.push({
      action: 'Align AE, CSE, and Renewals on save plan and forecast category',
      ownerRole: 'Renewals',
      rationale: 'Churn or downsell signals are present on the renewal opportunity.',
      priority: 'high',
      sourceSignalIds: renewalRisks.flatMap((r) => r.sourceSignalIds),
    });
  }

  if (supportFindings.length > 0) {
    actions.push({
      action: 'Review open Cerebro risks and support escalations with Support/Product',
      ownerRole: 'Support',
      rationale: 'Elevated support or product risk signals require coordinated response.',
      priority: supportFindings.some((f) => f.impact === 'high') ? 'high' : 'medium',
      sourceSignalIds: supportFindings.flatMap((f) => f.sourceSignalIds),
    });
  }

  if (expansionHypotheses.length > 0) {
    actions.push({
      action: 'Validate expansion hypothesis with AE and schedule customer discovery',
      ownerRole: 'AE',
      rationale: 'Usage or pipeline signals suggest expansion potential.',
      priority: 'medium',
      sourceSignalIds: expansionHypotheses.flatMap((h) => h.sourceSignalIds),
    });
  }

  const staleCommentary = renewalRisks.find((r) => r.title.includes('Stale CSE commentary'));
  if (staleCommentary) {
    actions.push({
      action: 'Refresh CSE account commentary before next leadership review',
      ownerRole: 'CSE',
      rationale: staleCommentary.detail,
      priority: 'medium',
      sourceSignalIds: staleCommentary.sourceSignalIds,
    });
  }

  if (actions.length === 0) {
    actions.push({
      action: 'Maintain cadence and monitor renewal timeline',
      ownerRole: 'CSE',
      rationale: 'No critical risk signals detected; continue standard engagement.',
      priority: 'low',
      sourceSignalIds: signals.slice(0, 3).map((s) => s.id),
    });
  }

  return actions.slice(0, 6);
}

function buildExecutiveSummary(
  accountName: string,
  renewalOutlook: AccountPlan['summary']['renewalOutlook'],
  expansionPotential: AccountPlan['summary']['expansionPotential'],
  confidence: AccountPlan['summary']['confidence'],
): { headline: string; executiveSummary: string } {
  const headline = `${accountName}: renewal ${renewalOutlook.replace('_', ' ')}, expansion ${expansionPotential}`;
  const executiveSummary =
    `This account plan summarizes verified signals for ${accountName}. ` +
    `Renewal outlook is ${renewalOutlook.replace('_', ' ')} and expansion potential is ${expansionPotential}. ` +
    `Overall confidence in this assessment is ${confidence}. ` +
    `Recommendations below are derived from cited evidence; facts are limited to normalized source signals.`;
  return { headline, executiveSummary };
}

export function assembleAccountPlan(input: GenerateAccountPlanInput): AccountPlan {
  const now = input.now ?? Date.now();
  const generatedAt = new Date(now).toISOString();
  const view = input.view;
  const a = view.account;

  const allSignals = input.collectorOutputs.flatMap((c) => c.signals);
  const collectorRuns: AccountPlanCollectorRun[] = input.collectorOutputs.map((c) => c.run);

  const renewal = scoreRenewalOutlook(view, allSignals, now);
  const expansion = scoreExpansionPotential(view, allSignals);
  const support = scoreSupportRisk(view, allSignals);
  const dataQuality = detectDataQualityIssues(
    allSignals,
    collectorRuns,
    renewal.outlook,
    expansion.potential,
  );
  const confidence = computePlanConfidence(allSignals, dataQuality.collectorFailures);

  const renewalOpp = nextFutureRenewalOpp(view, now);
  const commentary = stripHtml(a.cseSentimentCommentary);

  const usageExpansion = allSignals
    .filter((s) => s.category === 'cerebro_usage' && s.value === true)
    .map(
      (s): AccountPlan['productUsage']['expansionSignals'][number] => ({
        title: s.label,
        detail: String(s.value),
        confidence: s.confidence,
        impact: 'medium',
        sourceSignalIds: [s.id],
      }),
    );

  const usageRisk = allSignals
    .filter((s) => s.id === 'usage:utilization_risk' && s.value === true)
    .map(
      (s): AccountPlan['productUsage']['riskSignals'][number] => ({
        title: 'Underutilization risk',
        detail: 'Cerebro utilization risk flag is active.',
        confidence: s.confidence,
        impact: 'medium',
        sourceSignalIds: [s.id],
      }),
    );

  const engagementGap = daysSinceLastActivity(a, now);
  const relationshipFindings = [];
  if (engagementGap != null && engagementGap > 21) {
    relationshipFindings.push({
      title: 'Engagement gap',
      detail: `Last customer-facing activity was ${engagementGap} days ago.`,
      confidence: 'medium' as const,
      impact: 'medium' as const,
      sourceSignalIds: [] as string[],
    });
  }

  const meetingCount = a.recentMeetings?.length ?? 0;
  if (meetingCount > 0) {
    relationshipFindings.push({
      title: 'Recent meetings indexed',
      detail: `${meetingCount} recent meeting(s) found in MDAS snapshot.`,
      confidence: 'medium' as const,
      impact: 'low' as const,
      sourceSignalIds: [],
    });
  }

  const { headline, executiveSummary } = buildExecutiveSummary(
    a.accountName,
    renewal.outlook,
    expansion.potential,
    confidence,
  );

  const blockers = renewal.risks
    .filter((r) => r.impact === 'high')
    .map((r) => ({
      title: r.title,
      detail: r.detail,
      confidence: r.confidence,
      impact: r.impact,
      sourceSignalIds: r.sourceSignalIds,
    }));

  return {
    accountId: a.accountId,
    generatedAt,
    summary: {
      headline,
      renewalOutlook: renewal.outlook,
      expansionPotential: expansion.potential,
      confidence,
      executiveSummary,
    },
    renewal: {
      renewalDate: renewalOpp?.closeDate,
      fiscalPeriod: renewalOpp?.closeQuarter,
      stage: renewalOpp?.stageName,
      availableToRenew: renewalOpp?.availableToRenewUSD ?? undefined,
      currentAcv: renewalOpp?.acv ?? undefined,
      acvDelta: renewalOpp?.acvDelta ?? undefined,
      forecastMostLikely: renewalOpp?.forecastMostLikely ?? undefined,
      renewalStatus: renewalOpp?.stageName,
      churnOrDownsellReason: renewalOpp?.churnDownsellReason ?? a.churnReason ?? undefined,
      assessment:
        renewal.outlook === 'at_risk'
          ? 'Renewal shows multiple risk indicators across sentiment, forecast, and/or support signals.'
          : renewal.outlook === 'positive'
            ? 'Renewal indicators are favorable based on available structured signals.'
            : 'Renewal posture is mixed or insufficiently covered by available signals.',
      risks: renewal.risks,
    },
    expansion: {
      hypotheses: expansion.hypotheses,
      recommendedProductsOrPlays:
        expansion.potential === 'high' || expansion.potential === 'medium'
          ? [
              {
                title: 'Explore product white space',
                detail: `Active lines: ${a.activeProductLines.join(', ') || 'unknown'}.`,
                confidence: 'medium',
                impact: 'medium',
                sourceSignalIds: allSignals
                  .filter((s) => s.id === 'sf:active_product_lines')
                  .map((s) => s.id),
              },
            ]
          : [],
      blockers,
    },
    supportAndRisk: {
      overallRisk: support.overallRisk,
      findings: support.findings,
      openQuestions:
        support.overallRisk === 'unknown'
          ? ['Support risk could not be fully assessed — Cerebro data may be missing.']
          : [],
    },
    productUsage: {
      usageAssessment:
        usageRisk.length > 0
          ? 'Usage signals indicate underutilization or engagement risk.'
          : usageExpansion.length > 0
            ? 'Usage signals suggest healthy or expanding adoption.'
            : 'Insufficient product usage coverage to assess confidently.',
      expansionSignals: usageExpansion,
      riskSignals: usageRisk,
    },
    customerHealth: {
      cseSentiment: a.cseSentiment ?? undefined,
      cseCommentary: commentary ? commentary.slice(0, 400) : undefined,
      healthAssessment:
        a.cseSentiment === 'Green'
          ? 'CSE sentiment is positive.'
          : a.cseSentiment === 'Red' || a.cseSentiment === 'Confirmed Churn'
            ? 'CSE sentiment indicates customer health risk.'
            : 'CSE health posture is neutral or unknown.',
      findings: renewal.risks.filter((r) => /CSE|commentary|engagement/i.test(r.title)),
    },
    relationshipAndEngagement: {
      assessment:
        engagementGap != null && engagementGap > 30
          ? 'Customer engagement appears limited recently.'
          : 'Engagement signals are within expected range or inconclusive.',
      findings: relationshipFindings,
      openQuestions: !a.salesforceSlackChannelUrl ? ['Internal Slack channel not mapped.'] : [],
    },
    actionPlan: buildActions(renewal.risks, support.findings, expansion.hypotheses, allSignals),
    evidence: allSignals,
    dataQuality,
  };
}

export function generateAccountPlan(input: GenerateAccountPlanInput): AccountPlan {
  return assembleAccountPlan(input);
}

export { ACCOUNT_PLAN_SCHEMA_VERSION };
