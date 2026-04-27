import {
  AccountView,
  Bucket,
  CanonicalAccount,
  CanonicalOpportunity,
  CerebroRiskCategory,
  ChangeEvent,
  HygieneViolation,
  RiskIdentifier,
  UpsellAssessment,
  UpsellBand,
  isConfirmedChurn,
} from '@mdas/canonical';

export const SCORING_VERSION = 'v0.1.0';

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(iso: string | null | undefined, ref = Date.now()): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((ref - t) / DAY);
}

function daysUntil(iso: string | null | undefined, ref = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - ref) / DAY);
}

// ---------- Risk identifier (direct passthrough) ----------

export function getRiskIdentifier(account: CanonicalAccount): RiskIdentifier {
  if (account.cerebroRiskCategory) {
    return {
      level: account.cerebroRiskCategory,
      source: 'cerebro',
      rationale:
        account.cerebroRiskAnalysis ??
        'Cerebro Risk Category (no analysis text available)',
    };
  }
  const risks = account.cerebroRisks;
  const trueRisks = (Object.values(risks) as (boolean | null)[]).filter(Boolean).length;
  if (trueRisks >= 4)
    return {
      level: 'Critical',
      source: 'fallback',
      rationale: `${trueRisks} of 7 Cerebro risks are True; Risk Category missing`,
    };
  if (trueRisks >= 2)
    return {
      level: 'High',
      source: 'fallback',
      rationale: `${trueRisks} of 7 Cerebro risks are True; Risk Category missing`,
    };
  if (trueRisks === 1)
    return {
      level: 'Medium',
      source: 'fallback',
      rationale: `1 of 7 Cerebro risks is True; Risk Category missing`,
    };
  if (account.cseSentiment === 'Red')
    return {
      level: 'High',
      source: 'fallback',
      rationale: 'CSE Sentiment Red; no Cerebro data',
    };
  if (account.cseSentiment === 'Yellow')
    return {
      level: 'Medium',
      source: 'fallback',
      rationale: 'CSE Sentiment Yellow; no Cerebro data',
    };
  return {
    level: 'Unknown',
    source: 'fallback',
    rationale: 'No Cerebro Risk Category and no fallback signals available',
  };
}

// ---------- Buckets ----------

export function bucketAccount(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
): Bucket {
  if (isConfirmedChurn(account, opps)) return 'Confirmed Churn';
  const lvl = getRiskIdentifier(account).level;
  if (lvl === 'Critical' || lvl === 'High') return 'Saveable Risk';
  return 'Healthy';
}

// ---------- Upsell ----------

const SUITE_PRODUCTS = ['Zuora Billing', 'Zuora Revenue', 'Zuora Payments', 'Zephr', 'CPQ'];

export function scoreUpsell(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
  prevRiskCategory?: CerebroRiskCategory,
): UpsellAssessment {
  const signals: { label: string; points: number }[] = [];
  const now = Date.now();

  if (
    opps.some(
      (o) =>
        ['Upsell', 'Cross-Sell'].includes(o.type) &&
        !/closed/i.test(o.stageName),
    )
  ) {
    signals.push({ label: 'Open Upsell/Cross-Sell opportunity', points: 30 });
  }

  if (
    account.workshops.some(
      (w) => w.workshopDate && now - Date.parse(w.workshopDate) <= 90 * DAY,
    )
  ) {
    signals.push({ label: 'Workshop logged in last 90d', points: 15 });
  }

  if (prevRiskCategory && account.cerebroRiskCategory) {
    const order: CerebroRiskCategory[] = ['Low', 'Medium', 'High', 'Critical'];
    const prev = order.indexOf(prevRiskCategory);
    const curr = order.indexOf(account.cerebroRiskCategory);
    if (prev > -1 && curr > -1 && curr < prev) {
      signals.push({ label: 'Cerebro Risk Category improved WoW', points: 15 });
    }
  }

  const pbu = account.cerebroSubMetrics?.['Projected Billing Utilization (%)'];
  if (typeof pbu === 'number' && pbu > 70) {
    signals.push({ label: `Projected Billing Utilization ${pbu}%`, points: 15 });
  }

  const acvDeltaSum = opps.reduce((s, o) => s + (o.acvDelta ?? 0), 0);
  if (account.cseSentiment === 'Green' && acvDeltaSum >= 0) {
    signals.push({ label: 'Sentiment Green + non-negative ACV Δ', points: 10 });
  }

  if (account.activeProductLines.length < 3) {
    signals.push({
      label: `Whitespace: ${account.activeProductLines.length} of ${SUITE_PRODUCTS.length} products`,
      points: 10,
    });
  }

  if (
    account.recentMeetings.some(
      (m) => now - Date.parse(m.startTime) <= 30 * DAY,
    )
  ) {
    signals.push({ label: 'Exec meeting in last 30d', points: 5 });
  }

  const score = Math.min(
    100,
    signals.reduce((s, x) => s + x.points, 0),
  );
  let band: UpsellBand = 'Watch';
  if (score >= 76) band = 'Hot';
  else if (score >= 51) band = 'Active';
  else if (score >= 26) band = 'Qualified';

  return { score, band, signals };
}

// ---------- Hygiene ----------

export function evaluateHygiene(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
): HygieneViolation[] {
  const violations: HygieneViolation[] = [];
  const sentiment = account.cseSentiment;

  // Stale sentiment commentary
  const stale = daysAgo(account.cseSentimentCommentaryLastUpdated);
  if (
    ((sentiment === 'Red' || sentiment === 'Yellow') && stale > 14) ||
    (sentiment === 'Green' && stale > 30)
  ) {
    violations.push({
      rule: 'stale_sentiment_commentary',
      description: `Sentiment commentary last updated ${
        Number.isFinite(stale) ? stale + ' days ago' : 'never'
      } (sentiment ${sentiment ?? 'unset'})`,
      coachingPrompt: `Update CSE Sentiment Commentary on ${account.accountName}. Use the standard template: "STATE AND RENEWAL RISK:" + "ACTION PLAN:".`,
      confidence: 'high',
    });
  }

  // Missing next action
  const hasOpenTask = account.gainsightTasks.some(
    (t) => !/closed|complete|done/i.test(t.status),
  );
  const anyNextSteps = opps.some((o) => (o.scNextSteps ?? '').trim().length > 0);
  if (!anyNextSteps && !hasOpenTask) {
    violations.push({
      rule: 'missing_next_action',
      description: 'No SC Next Steps on any opp and no open Gainsight task',
      coachingPrompt: `Add a concrete next step on ${account.accountName} (Salesforce Opportunity SC Next Steps or Gainsight CTA Task with owner+due date).`,
      confidence: 'high',
    });
  }

  // No workshop logged
  const recentWorkshop = account.workshops.some(
    (w) =>
      w.workshopDate && Date.now() - Date.parse(w.workshopDate) <= 365 * DAY,
  );
  if (!recentWorkshop) {
    violations.push({
      rule: 'no_workshop_logged',
      description: 'No workshop engagement in the last 365 days',
      coachingPrompt: `Schedule and log a workshop for ${account.accountName} (Workshop_Engagement__c).`,
      confidence: 'high',
    });
  }

  // Missing FLM notes on risk
  if (sentiment === 'Red' || sentiment === 'Yellow') {
    for (const o of opps) {
      if (!(o.flmNotes ?? '').trim()) {
        violations.push({
          rule: 'missing_flm_notes_on_risk',
          description: `Opportunity ${o.opportunityName} has no FLM Notes; account sentiment is ${sentiment}`,
          coachingPrompt: `Add FLM Notes to ${o.opportunityName}. Frame state of renewal risk and action plan.`,
          confidence: 'high',
          opportunityId: o.opportunityId,
        });
      }
    }
  }

  // No exec engagement
  const execMeetings = account.cerebroSubMetrics?.['Executive Meeting Count (90d)'];
  const lvl = getRiskIdentifier(account).level;
  if (
    typeof execMeetings === 'number' &&
    execMeetings === 0 &&
    (lvl === 'High' || lvl === 'Critical')
  ) {
    violations.push({
      rule: 'no_exec_engagement',
      description: 'Zero executive meetings in last 90d on a High/Critical risk account',
      coachingPrompt: `Book an exec engagement on ${account.accountName} this quarter. Loop in the AE and request a sponsor from leadership if needed.`,
      confidence: 'high',
    });
  }

  // Get-to-green plan missing (low confidence regex check)
  if (
    (sentiment === 'Red' || sentiment === 'Yellow') &&
    !/ACTION\s*PLAN\s*:/i.test(account.cseSentimentCommentary ?? '')
  ) {
    violations.push({
      rule: 'get_to_green_plan_missing',
      description: 'Sentiment commentary does not contain "ACTION PLAN:" section',
      coachingPrompt: `Add an "ACTION PLAN:" block to the CSE Sentiment Commentary on ${account.accountName}.`,
      confidence: 'low',
    });
  }

  return violations;
}

// ---------- Manager priority ----------

export function comparePriority(a: AccountView, b: AccountView): number {
  const bucketOrder: Record<Bucket, number> = {
    'Saveable Risk': 0,
    'Confirmed Churn': 1,
    Healthy: 2,
  };
  const da = bucketOrder[a.bucket] - bucketOrder[b.bucket];
  if (da !== 0) return da;

  const riskOrder: Record<string, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
    Unknown: 4,
  };
  const dr = (riskOrder[a.risk.level ?? 'Unknown'] ?? 4) - (riskOrder[b.risk.level ?? 'Unknown'] ?? 4);
  if (dr !== 0) return dr;

  const ad = a.daysToRenewal ?? Number.POSITIVE_INFINITY;
  const bd = b.daysToRenewal ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;

  return (b.atrUSD ?? 0) - (a.atrUSD ?? 0);
}

// ---------- Account view computation ----------

export function buildAccountView(
  account: CanonicalAccount,
  opps: CanonicalOpportunity[],
  opts: {
    prevRiskCategory?: CerebroRiskCategory;
    changeEvents?: ChangeEvent[];
  } = {},
): AccountView {
  const risk = getRiskIdentifier(account);
  const bucket = bucketAccount(account, opps);
  const upsell = scoreUpsell(account, opps, opts.prevRiskCategory);
  const violations = evaluateHygiene(account, opps);

  // Renewal date = earliest non-closed renewal opp closeDate; fall back to any opp.
  const renewalCandidates = opps.filter((o) => /renewal/i.test(o.type));
  const renewals = (renewalCandidates.length ? renewalCandidates : opps)
    .filter((o) => !!o.closeDate)
    .sort((a, b) => Date.parse(a.closeDate) - Date.parse(b.closeDate));
  const renewalDate = renewals[0]?.closeDate ?? null;

  const atrUSD = opps.reduce((s, o) => s + (o.availableToRenewUSD ?? 0), 0);
  const acvAtRiskUSD =
    bucket === 'Healthy'
      ? 0
      : opps.reduce(
          (s, o) =>
            s + Math.abs(o.knownChurnUSD ?? 0) + Math.max(0, -(o.acvDelta ?? 0)),
          0,
        );

  return {
    account,
    opportunities: opps,
    bucket,
    risk,
    upsell,
    hygiene: { score: violations.length, violations },
    priorityRank: 0, // assigned after sort
    daysToRenewal: daysUntil(renewalDate),
    atrUSD,
    acvAtRiskUSD,
    changeEvents: opts.changeEvents ?? [],
  };
}

export function rankAccountViews(views: AccountView[]): AccountView[] {
  const sorted = [...views].sort(comparePriority);
  sorted.forEach((v, i) => {
    v.priorityRank = i + 1;
  });
  return sorted;
}

// ---------- Week-over-week change detection ----------

const FIELD_LABELS: Record<string, { category: ChangeEvent['category']; label: (o: unknown, n: unknown) => string }> = {
  cerebroRiskCategory: {
    category: 'risk',
    label: (o, n) => `Cerebro Risk Category ${o ?? '∅'} → ${n ?? '∅'}`,
  },
  cseSentiment: {
    category: 'sentiment',
    label: (o, n) => `CSE Sentiment ${o ?? '∅'} → ${n ?? '∅'}`,
  },
  cseSentimentCommentary: {
    category: 'sentiment',
    label: () => `Sentiment commentary updated`,
  },
};

const OPP_FIELD_LABELS: Record<
  string,
  { category: ChangeEvent['category']; label: (o: unknown, n: unknown) => string }
> = {
  stageName: { category: 'forecast', label: (o, n) => `Stage ${o} → ${n}` },
  closeDate: { category: 'forecast', label: (o, n) => `Close date ${o} → ${n}` },
  forecastMostLikely: {
    category: 'forecast',
    label: (o, n) => `Forecast Most Likely ${o ?? 0} → ${n ?? 0}`,
  },
  mostLikelyConfidence: {
    category: 'forecast',
    label: (o, n) => `Confidence ${o ?? '∅'} → ${n ?? '∅'}`,
  },
  acvDelta: {
    category: 'forecast',
    label: (o, n) => `ACV Δ ${o ?? 0} → ${n ?? 0}`,
  },
  flmNotes: { category: 'hygiene', label: () => `FLM notes updated` },
  scNextSteps: { category: 'hygiene', label: () => `SC Next Steps updated` },
  salesEngineer: {
    category: 'hygiene',
    label: (o, n) => `Assigned CSE changed (${(o as { name?: string } | null)?.name ?? '∅'} → ${(n as { name?: string } | null)?.name ?? '∅'})`,
  },
};

export function diffAccount(
  prev: CanonicalAccount | undefined,
  curr: CanonicalAccount,
  prevRefreshId: string,
  currRefreshId: string,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  if (!prev) return events;

  for (const [field, meta] of Object.entries(FIELD_LABELS)) {
    const o = (prev as unknown as Record<string, unknown>)[field];
    const n = (curr as unknown as Record<string, unknown>)[field];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      events.push({
        accountId: curr.accountId,
        field,
        oldValue: o,
        newValue: n,
        occurredBetween: [prevRefreshId, currRefreshId],
        category: meta.category,
        label: meta.label(o, n),
      });
    }
  }

  // Cerebro 7 risk booleans
  type RiskKey = keyof CanonicalAccount['cerebroRisks'];
  const riskKeys = Object.keys(curr.cerebroRisks) as RiskKey[];
  for (const k of riskKeys) {
    const o = prev.cerebroRisks ? prev.cerebroRisks[k] ?? null : null;
    const n = curr.cerebroRisks[k];
    if (o !== n) {
      events.push({
        accountId: curr.accountId,
        field: `cerebroRisks.${k}`,
        oldValue: o,
        newValue: n,
        occurredBetween: [prevRefreshId, currRefreshId],
        category: 'risk',
        label: `${k} ${o ?? '∅'} → ${n ?? '∅'}`,
      });
    }
  }

  // Workshop count delta
  const prevW = prev.workshops?.length ?? 0;
  const currW = curr.workshops.length;
  if (currW > prevW) {
    events.push({
      accountId: curr.accountId,
      field: 'workshops',
      oldValue: prevW,
      newValue: currW,
      occurredBetween: [prevRefreshId, currRefreshId],
      category: 'workshop',
      label: `New workshop logged (${prevW} → ${currW})`,
    });
  }

  return events;
}

export function diffOpportunity(
  prev: CanonicalOpportunity | undefined,
  curr: CanonicalOpportunity,
  prevRefreshId: string,
  currRefreshId: string,
): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  if (!prev) return events;

  for (const [field, meta] of Object.entries(OPP_FIELD_LABELS)) {
    const o = (prev as unknown as Record<string, unknown>)[field];
    const n = (curr as unknown as Record<string, unknown>)[field];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      events.push({
        accountId: curr.accountId,
        opportunityId: curr.opportunityId,
        field,
        oldValue: o,
        newValue: n,
        occurredBetween: [prevRefreshId, currRefreshId],
        category: meta.category,
        label: `${curr.opportunityName}: ${meta.label(o, n)}`,
      });
    }
  }

  if (
    !prev.fullChurnNotificationToOwnerDate &&
    curr.fullChurnNotificationToOwnerDate
  ) {
    events.push({
      accountId: curr.accountId,
      opportunityId: curr.opportunityId,
      field: 'fullChurnNotificationToOwnerDate',
      oldValue: null,
      newValue: curr.fullChurnNotificationToOwnerDate,
      occurredBetween: [prevRefreshId, currRefreshId],
      category: 'churn-notice',
      label: `${curr.opportunityName}: Churn notice submitted`,
    });
  }

  return events;
}

export function diffAll(
  prev: { accounts: CanonicalAccount[]; opportunities: CanonicalOpportunity[] } | null,
  curr: { accounts: CanonicalAccount[]; opportunities: CanonicalOpportunity[] },
  prevRefreshId: string,
  currRefreshId: string,
): ChangeEvent[] {
  if (!prev) return [];
  const prevAccByID = new Map(prev.accounts.map((a) => [a.accountId, a]));
  const prevOppByID = new Map(prev.opportunities.map((o) => [o.opportunityId, o]));
  const events: ChangeEvent[] = [];
  for (const a of curr.accounts) {
    events.push(...diffAccount(prevAccByID.get(a.accountId), a, prevRefreshId, currRefreshId));
  }
  for (const o of curr.opportunities) {
    events.push(...diffOpportunity(prevOppByID.get(o.opportunityId), o, prevRefreshId, currRefreshId));
  }
  return events;
}
