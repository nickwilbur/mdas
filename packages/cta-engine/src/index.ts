import type { AccountView } from '@mdas/canonical';
import { computeRiskScore } from '@mdas/scoring';
import type { CTAEngineConfig } from './config.js';
import { mergeConfig } from './config.js';
import { buildCTARecord } from './build.js';
import { capCtas, decideDedup } from './dedup.js';
import { evaluatePlayCandidates, pickBestPlay } from './rules.js';
import { shouldSuppress } from './suppress.js';
import { accountNeedsCtaAttention, isRiskOrDarkPlay } from './health.js';
import type {
  CTAEvaluationResult,
  CTARecord,
  CTALogEntry,
} from './types.js';

export type { CTARecord, CTALogEntry, CTAPlayType } from './types.js';
export { DEFAULT_CTA_CONFIG, mergeConfig } from './config.js';
export { assessDarkAccount, findSimpleDarkAccounts } from './dark-account.js';
export { evaluatePlayCandidates, pickBestPlay } from './rules.js';
export { buildCTARecord } from './build.js';
export { decideDedup, capCtas, mergeCTAUpdate } from './dedup.js';
export { shouldSuppress, dedupKey } from './suppress.js';
export { hasRecentActivity, daysSinceLastActivity } from './activity.js';
export {
  EXPAND3_FRANCHISE,
  filterExpand3Views,
  hasOpenRenewalInFiscalYears,
  isChurnedAccount,
  nextFutureRenewalOpp,
  normalizeExpand3View,
} from './scope.js';
export { computeCtaDeadline } from './deadline.js';
export { resolveCseSlackOwner } from './slack-owners.js';
export { accountNeedsCtaAttention, isRiskOrDarkPlay } from './health.js';
export { fiscalYearFromDate, fiscalQuarterFromDate } from './fiscal.js';

export interface GenerateCTAsOptions {
  config?: Partial<CTAEngineConfig>;
  now?: number;
  scanDate?: string;
  accountFilter?: string;
  existingLog?: Map<string, CTALogEntry>;
  skipDedup?: boolean;
}

function enrichRiskScore(view: AccountView, now: number): AccountView {
  if (view.riskScore) return view;
  const riskScore = computeRiskScore({
    account: view.account,
    opportunities: view.opportunities,
    changeEvents: view.changeEvents,
    now,
  });
  return { ...view, riskScore };
}

/**
 * Evaluate a single account and return a CTA (or suppression reason).
 */
export function evaluateAccount(
  view: AccountView,
  opts: GenerateCTAsOptions = {},
): CTAEvaluationResult {
  const config = mergeConfig(opts.config);
  const now = opts.now ?? Date.now();
  const scanDate = opts.scanDate ?? new Date(now).toISOString().slice(0, 10);
  const enriched = enrichRiskScore(view, now);

  const candidates = evaluatePlayCandidates({
    view: enriched,
    config,
    now,
    scanDate,
  });

  const best = pickBestPlay(candidates);
  if (!best) {
    return { cta: null, suppressed: true, suppressed_reason: 'No rules matched', play_type_candidates: [] };
  }

  if (config.requireRiskOrUnhealthy) {
    const health = accountNeedsCtaAttention(enriched, config, now);
    const riskPlay = isRiskOrDarkPlay(best.play_type);
    if (!riskPlay && !health.needsAttention) {
      return {
        cta: null,
        suppressed: true,
        suppressed_reason: 'Healthy — no dark signals or identified risk',
        play_type_candidates: candidates.map((c) => ({
          play_type: c.play_type,
          priority_score: c.priority_score,
        })),
      };
    }
  }

  const suppress = shouldSuppress(enriched, best.play_type, config, now);
  if (suppress.suppressed) {
    return {
      cta: null,
      suppressed: true,
      suppressed_reason: suppress.reason,
      play_type_candidates: candidates.map((c) => ({
        play_type: c.play_type,
        priority_score: c.priority_score,
      })),
    };
  }

  const cta = buildCTARecord(enriched, best, scanDate, config, now);
  return {
    cta,
    suppressed: false,
    play_type_candidates: candidates.map((c) => ({
      play_type: c.play_type,
      priority_score: c.priority_score,
    })),
  };
}

export interface GenerateCTAsResult {
  ctas: CTARecord[];
  suppressed: Array<{ account_name: string; reason: string }>;
  updated: CTARecord[];
  skipped: number;
}

/**
 * Generate CTAs for a set of account views (one CTA per account max).
 */
export function generateCTAsForViews(
  views: AccountView[],
  opts: GenerateCTAsOptions = {},
): GenerateCTAsResult {
  const config = mergeConfig(opts.config);
  const now = opts.now ?? Date.now();
  const scanDate = opts.scanDate ?? new Date(now).toISOString().slice(0, 10);
  const existingLog = opts.existingLog ?? new Map<string, CTALogEntry>();

  let filtered = views;
  if (opts.accountFilter) {
    const q = opts.accountFilter.toLowerCase();
    filtered = views.filter((v) => v.account.accountName.toLowerCase().includes(q));
  }

  const ctas: CTARecord[] = [];
  const suppressed: Array<{ account_name: string; reason: string }> = [];
  const updated: CTARecord[] = [];
  let skipped = 0;

  for (const view of filtered) {
    const result = evaluateAccount(view, { ...opts, config, now, scanDate });
    if (!result.cta) {
      if (result.suppressed_reason) {
        suppressed.push({
          account_name: view.account.accountName,
          reason: result.suppressed_reason,
        });
      }
      continue;
    }

    if (!opts.skipDedup) {
      const decision = decideDedup(result.cta, existingLog, config, now);
      if (decision.action === 'skip') {
        skipped++;
        continue;
      }
      if (decision.action === 'update' && decision.existing) {
        const merged = {
          ...decision.existing,
          ...result.cta,
          cta_id: decision.existing.cta_id,
          posted_at: decision.existing.posted_at,
        };
        updated.push(merged);
        ctas.push(merged);
        continue;
      }
    }

    ctas.push(result.cta);
  }

  // Sort: risk color, then priority, then deadline
  const riskOrder: Record<string, number> = {
    Red: 0,
    '🔴': 0,
    Yellow: 1,
    '🟡': 1,
    Green: 2,
    '🟢': 2,
  };
  ctas.sort((a, b) => {
    const ra = riskOrder[a.risk_color] ?? 3;
    const rb = riskOrder[b.risk_color] ?? 3;
    if (ra !== rb) return ra - rb;
    const pa = a.priority_score ?? 0;
    const pb = b.priority_score ?? 0;
    if (pa !== pb) return pb - pa;
    return a.deadline.localeCompare(b.deadline);
  });

  const capped = capCtas(ctas, config.maxCtasPerScan);

  return { ctas: capped, suppressed, updated, skipped };
}
