import type { AccountView } from '@mdas/canonical';
import { nextFutureRenewalOpp } from '@mdas/cta-engine';
import { daysSinceLastActivity } from '@mdas/cta-engine';
import type {
  AccountPlanFinding,
  AccountPlanSignal,
  ExpansionPotential,
  PlanConfidence,
  RenewalOutlook,
  SupportRiskLevel,
} from './types.js';
import {
  CSE_COMMENTARY_STALE_DAYS_GREEN,
  CSE_COMMENTARY_STALE_DAYS_RED_YELLOW,
} from './constants.js';
import { stripHtml } from './utils.js';

function findSignal(signals: AccountPlanSignal[], idPrefix: string): AccountPlanSignal | undefined {
  return signals.find((s) => s.id.startsWith(idPrefix));
}

function sentimentScore(sentiment: string | null | undefined): number {
  switch (sentiment) {
    case 'Green':
      return 2;
    case 'Yellow':
      return 0;
    case 'Red':
      return -2;
    case 'Confirmed Churn':
      return -4;
    default:
      return 0;
  }
}

export function scoreRenewalOutlook(
  view: AccountView,
  signals: AccountPlanSignal[],
  now: number,
): { outlook: RenewalOutlook; risks: AccountPlanFinding[]; score: number } {
  const risks: AccountPlanFinding[] = [];
  let score = 0;

  const renewal = nextFutureRenewalOpp(view, now);
  const sentimentSig = findSignal(signals, 'cse:sentiment');
  const sentiment = typeof sentimentSig?.value === 'string' ? sentimentSig.value : view.account.cseSentiment;
  score += sentimentScore(sentiment);

  if (sentiment === 'Red' || sentiment === 'Confirmed Churn') {
    risks.push({
      title: 'Negative CSE sentiment',
      detail: `CSE sentiment is ${sentiment ?? 'unknown'}.`,
      confidence: 'high',
      impact: 'high',
      sourceSignalIds: sentimentSig ? [sentimentSig.id] : [],
    });
  }

  const commentarySig = findSignal(signals, 'cse:commentary');
  const staleDays =
    sentiment === 'Green' ? CSE_COMMENTARY_STALE_DAYS_GREEN : CSE_COMMENTARY_STALE_DAYS_RED_YELLOW;
  const commentaryAge = view.account.cseSentimentCommentaryLastUpdated
    ? Math.floor(
        (now - Date.parse(view.account.cseSentimentCommentaryLastUpdated)) / (86_400_000),
      )
    : null;

  if (!commentarySig && !stripHtml(view.account.cseSentimentCommentary)) {
    score -= 1;
    risks.push({
      title: 'Missing CSE commentary',
      detail: 'No recent CSE sentiment commentary on record.',
      confidence: 'high',
      impact: 'medium',
      sourceSignalIds: [],
    });
  } else if (commentaryAge != null && commentaryAge > staleDays) {
    score -= 1;
    risks.push({
      title: 'Stale CSE commentary',
      detail: `CSE commentary last updated ${commentaryAge} days ago (threshold ${staleDays}d).`,
      confidence: 'high',
      impact: 'medium',
      sourceSignalIds: commentarySig ? [commentarySig.id] : [],
    });
  }

  if (renewal) {
    if (/churn|downsell|omit/i.test(renewal.churnRisk ?? '')) {
      score -= 3;
      risks.push({
        title: 'Renewal churn risk flagged',
        detail: renewal.churnRisk ?? renewal.churnDownsellReason ?? 'Churn risk on renewal opportunity.',
        confidence: 'high',
        impact: 'high',
        sourceSignalIds: [findSignal(signals, 'sf:churn_risk')?.id].filter(Boolean) as string[],
      });
    }
    if (renewal.churnDownsellReason) {
      score -= 2;
      risks.push({
        title: 'Churn/downsell reason recorded',
        detail: renewal.churnDownsellReason,
        confidence: 'high',
        impact: 'high',
        sourceSignalIds: [findSignal(signals, 'sf:churn_downsell_reason')?.id].filter(Boolean) as string[],
      });
    }
    if (/pipeline|best case/i.test(renewal.forecastCategory ?? '')) {
      score -= 1;
    }
    if (view.daysToRenewal != null && view.daysToRenewal <= 90) {
      if (score < 0) {
        risks.push({
          title: 'Renewal approaching with risk signals',
          detail: `Renewal in ${view.daysToRenewal} days with elevated risk indicators.`,
          confidence: 'medium',
          impact: 'high',
          sourceSignalIds: [findSignal(signals, 'sf:days_to_renewal')?.id].filter(Boolean) as string[],
        });
      }
    }
  }

  const cerebroCat = view.account.cerebroRiskCategory;
  if (cerebroCat === 'High' || cerebroCat === 'Critical') {
    score -= 2;
    risks.push({
      title: 'Elevated Cerebro support risk',
      detail: `Cerebro risk category is ${cerebroCat}.`,
      confidence: 'high',
      impact: 'high',
      sourceSignalIds: [findSignal(signals, 'cerebro:risk_category')?.id].filter(Boolean) as string[],
    });
  }

  const utilizationRisk = findSignal(signals, 'usage:utilization_risk');
  if (utilizationRisk?.value === true) {
    score -= 1;
    risks.push({
      title: 'Product underutilization',
      detail: 'Cerebro flags utilization risk.',
      confidence: 'high',
      impact: 'medium',
      sourceSignalIds: [utilizationRisk.id],
    });
  }

  const activityGap = daysSinceLastActivity(view.account, now);
  if (activityGap != null && activityGap > 30) {
    score -= 1;
    risks.push({
      title: 'Low recent engagement',
      detail: `No customer-facing activity in ${activityGap} days.`,
      confidence: 'medium',
      impact: 'medium',
      sourceSignalIds: [],
    });
  }

  let outlook: RenewalOutlook = 'unknown';
  if (score >= 2) outlook = 'positive';
  else if (score >= 0) outlook = 'neutral';
  else if (score <= -2) outlook = 'at_risk';

  return { outlook, risks, score };
}

export function scoreExpansionPotential(
  view: AccountView,
  signals: AccountPlanSignal[],
): { potential: ExpansionPotential; hypotheses: AccountPlanFinding[]; score: number } {
  const hypotheses: AccountPlanFinding[] = [];
  let score = 0;

  const upsell = view.upsell;
  if (upsell.band === 'High') {
    score += 2;
    hypotheses.push({
      title: 'High upsell band',
      detail: `MDAS upsell assessment is High (score ${upsell.score}).`,
      confidence: 'high',
      impact: 'high',
      sourceSignalIds: [],
    });
  } else if (upsell.band === 'Medium') {
    score += 1;
  }

  const sentiment = view.account.cseSentiment;
  if (sentiment === 'Green') {
    score += 1;
    hypotheses.push({
      title: 'Positive CSE sentiment',
      detail: 'CSE sentiment is Green.',
      confidence: 'high',
      impact: 'medium',
      sourceSignalIds: [findSignal(signals, 'cse:sentiment')?.id].filter(Boolean) as string[],
    });
  }

  const expansionOpps = signals.filter((s) => s.category === 'opportunity');
  if (expansionOpps.length > 0) {
    score += 1;
    hypotheses.push({
      title: 'Open expansion pipeline',
      detail: `${expansionOpps.length} open expansion opportunity signal(s).`,
      confidence: 'high',
      impact: 'medium',
      sourceSignalIds: expansionOpps.map((s) => s.id),
    });
  }

  const usageSignals = signals.filter((s) => s.category === 'cerebro_usage');
  const overageHint = usageSignals.some(
    (s) => /overage|above|high/i.test(String(s.label)) && /true|high|yes/i.test(String(s.value)),
  );
  if (overageHint) {
    score += 2;
    hypotheses.push({
      title: 'Usage above entitlement',
      detail: 'Product usage metrics suggest overage or strong adoption.',
      confidence: 'medium',
      impact: 'high',
      sourceSignalIds: usageSignals.map((s) => s.id),
    });
  }

  if (view.account.activeProductLines.length >= 2) {
    score += 1;
  }

  let potential: ExpansionPotential = 'unknown';
  if (score >= 3) potential = 'high';
  else if (score >= 1) potential = 'medium';
  else if (score <= 0 && upsell.band === 'Low') potential = 'low';

  return { potential, hypotheses, score };
}

export function scoreSupportRisk(
  view: AccountView,
  signals: AccountPlanSignal[],
): { overallRisk: SupportRiskLevel; findings: AccountPlanFinding[]; score: number } {
  const findings: AccountPlanFinding[] = [];
  let score = 0;

  const cat = view.account.cerebroRiskCategory;
  if (cat === 'Critical') score += 4;
  else if (cat === 'High') score += 3;
  else if (cat === 'Medium') score += 1;

  const riskFlags = signals.filter((s) => s.id.startsWith('cerebro:risk_flag_') && s.value === true);
  score += riskFlags.length;

  for (const flag of riskFlags) {
    findings.push({
      title: flag.label,
      detail: 'Active Cerebro health risk flag.',
      confidence: 'high',
      impact: cat === 'Critical' || cat === 'High' ? 'high' : 'medium',
      sourceSignalIds: [flag.id],
    });
  }

  const liveConcerns = signals.filter((s) => s.id.startsWith('cerebro:live_concern_'));
  for (const concern of liveConcerns) {
    score += 1;
    findings.push({
      title: 'Cerebro live concern',
      detail: String(concern.value),
      confidence: 'medium',
      impact: 'medium',
      sourceSignalIds: [concern.id],
    });
  }

  const utilization = findSignal(signals, 'usage:utilization_risk');
  if (utilization?.value === true) {
    score += 1;
    findings.push({
      title: 'Declining or low product usage',
      detail: 'Utilization risk flagged in Cerebro.',
      confidence: 'high',
      impact: 'medium',
      sourceSignalIds: [utilization.id],
    });
  }

  let overallRisk: SupportRiskLevel = 'unknown';
  if (score >= 4) overallRisk = 'high';
  else if (score >= 2) overallRisk = 'medium';
  else if (score <= 0 && cat === 'Low') overallRisk = 'low';

  return { overallRisk, findings, score };
}

export function computePlanConfidence(
  signals: AccountPlanSignal[],
  collectorFailures: string[],
): PlanConfidence {
  let penalty = 0;
  const staleCount = signals.filter((s) => s.freshness === 'stale').length;
  const lowConfCount = signals.filter((s) => s.confidence === 'low').length;
  const unknownFresh = signals.filter((s) => s.freshness === 'unknown').length;

  penalty += collectorFailures.length;
  penalty += Math.floor(staleCount / 3);
  penalty += Math.floor(lowConfCount / 2);
  penalty += Math.floor(unknownFresh / 4);

  if (signals.length < 5) penalty += 2;

  if (penalty >= 4) return 'low';
  if (penalty >= 2) return 'medium';
  return 'high';
}

export function detectDataQualityIssues(
  signals: AccountPlanSignal[],
  collectorRuns: { collector: string; status: string; errorMessage?: string }[],
  renewalOutlook: RenewalOutlook,
  expansionPotential: ExpansionPotential,
): {
  missingSignals: string[];
  staleSignals: string[];
  conflictingSignals: string[];
  lowConfidenceSignals: string[];
  collectorFailures: string[];
  notes: string[];
} {
  const missingSignals: string[] = [];
  const staleSignals: string[] = [];
  const conflictingSignals: string[] = [];
  const lowConfidenceSignals: string[] = [];
  const collectorFailures: string[] = [];
  const notes: string[] = [];

  const has = (prefix: string) => signals.some((s) => s.id.startsWith(prefix));
  if (!has('cse:sentiment')) missingSignals.push('CSE sentiment');
  if (!has('cse:commentary')) missingSignals.push('CSE commentary');
  if (!has('sf:renewal_close_date')) missingSignals.push('Open renewal opportunity');
  if (!has('cerebro:risk_category')) missingSignals.push('Cerebro risk category');
  if (!has('usage:')) missingSignals.push('Product usage metrics');

  for (const s of signals) {
    if (s.freshness === 'stale') staleSignals.push(s.label);
    if (s.confidence === 'low') lowConfidenceSignals.push(s.label);
  }

  const positiveUsage = signals.some(
    (s) => s.category === 'cerebro_usage' && /high|growth|above/i.test(String(s.value)),
  );
  const negativeSupport = signals.some(
    (s) =>
      s.category === 'cerebro_support' &&
      (s.id.includes('risk_flag') || s.id.includes('live_concern')),
  );
  if (positiveUsage && negativeSupport) {
    conflictingSignals.push('Strong usage signals alongside elevated support risk');
  }

  if (renewalOutlook === 'positive' && expansionPotential === 'low') {
    conflictingSignals.push('Positive renewal outlook with low expansion potential');
  }

  for (const run of collectorRuns) {
    if (run.status === 'failed') {
      collectorFailures.push(`${run.collector}: ${run.errorMessage ?? 'failed'}`);
    } else if (run.status === 'partial') {
      notes.push(`${run.collector} returned partial data`);
    }
  }

  return {
    missingSignals,
    staleSignals,
    conflictingSignals,
    lowConfidenceSignals,
    collectorFailures,
    notes,
  };
}
