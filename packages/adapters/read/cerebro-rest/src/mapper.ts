// Map Cerebro REST health-risk JSON → CanonicalAccount partial.

import type {
  CanonicalAccount,
  CerebroRiskCategory,
  CerebroRisks,
  SourceLink,
} from '@mdas/canonical';
import type {
  CerebroAccountDetails,
  CerebroCustomerRisks,
  CerebroHealthRiskRecord,
  CerebroHealthRiskSignal,
} from './types.js';

const RISK_CATEGORIES = new Set(['Low', 'Medium', 'High', 'Critical']);

const HEALTH_SIGNAL_TO_RISK: Record<string, keyof CerebroRisks> = {
  utilization: 'utilizationRisk',
  share: 'shareRisk',
  engagement: 'engagementRisk',
  pricing: 'pricingRisk',
  legacyTech: 'legacyTechRisk',
  suite: 'suiteRisk',
  expertise: 'expertiseRisk',
};

function parseBool(raw: boolean | string | undefined | null): boolean | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'boolean') return raw;
  const v = String(raw).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  return null;
}

function normalizeRiskCategory(raw: unknown): CerebroRiskCategory {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = String(raw).trim();
  if (v === 'Moderate') return 'Medium';
  if (v === 'Moderate-to-High') return 'High';
  const normalized = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  if (normalized === 'Critical') return 'Critical';
  if (RISK_CATEGORIES.has(normalized)) return normalized as CerebroRiskCategory;
  if (v === 'High' || v === 'Critical' || v === 'Low') return v as CerebroRiskCategory;
  return null;
}

function mapHealthSignals(signals: CerebroHealthRiskSignal[] | null | undefined): CerebroRisks {
  const risks: CerebroRisks = {
    utilizationRisk: null,
    engagementRisk: null,
    suiteRisk: null,
    shareRisk: null,
    legacyTechRisk: null,
    expertiseRisk: null,
    pricingRisk: null,
  };
  if (!signals) return risks;
  for (const signal of signals) {
    const field = HEALTH_SIGNAL_TO_RISK[signal.name];
    if (field) risks[field] = parseBool(signal.atRisk);
  }
  return risks;
}

function flattenRecord(raw: CerebroHealthRiskRecord): Record<string, unknown> {
  if (raw.data && typeof raw.data === 'object') {
    return { ...raw, ...(raw.data as Record<string, unknown>) };
  }
  return raw;
}

function pickString(flat: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = flat[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return null;
}

function pickNumber(flat: Record<string, unknown>, key: string): number | null {
  const v = flat[key];
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const INT_METRICS = [
  'crProjectedBillingUtilization',
  'crProjectedRevenueUtilization',
  'crExecutiveMeetingCount',
  'crBillingProductShare',
  'crRevenueProductShare',
  'crOrdersApiUsage',
  'crEmailedInvoices',
  'crEpaymentsProcessed',
  'crInvoicesPosted',
  'crJournalEntries',
  'crOrders',
  'crQuotes',
  'crRevenueAmount',
  'crBillingCost',
  'crRevenueCost',
  'crDso',
] as const;

const BOOL_METRICS = [
  'crHasEnhancedServices',
  'crHasEsa',
  'crHasInvoiceSettlement',
  'crHasMs',
  'crHasPes',
  'crHasTam',
  'crHasUno',
  'crReportingUse',
] as const;

export interface CerebroRestMappedRecord {
  accountId: string;
  customerName: string | null;
  cerebroIndexedAt: string | null;
  patch: Partial<CanonicalAccount>;
}

/** Compose Cerebro Overall Assessment narrative for hover / drilldown. */
export function composeCerebroOverallAssessmentNarrative(
  detail: Pick<CerebroAccountDetails, 'summary'>,
  risks: CerebroCustomerRisks | null | undefined,
): string | null {
  const parts: string[] = [];
  const analysis = risks?.riskAnalysis?.trim();
  const rationale = risks?.riskCategoryRationale?.trim();
  const headline = detail.summary?.headline?.trim();
  if (analysis) parts.push(analysis);
  else if (rationale) parts.push(rationale);
  else if (headline) parts.push(headline);

  const bullets = [
    ...(detail.summary?.risksAndConcerns ?? []),
    ...(detail.summary?.whatChanged ?? []),
    ...(detail.summary?.suggestedFocus ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  if (bullets.length > 0 && parts.length === 0) {
    parts.push(bullets.slice(0, 4).join(' · '));
  } else if (bullets.length > 0 && !analysis) {
    parts.push(bullets.slice(0, 3).join(' · '));
  }

  return parts.join('\n\n').trim() || null;
}

/** Map `POST /api/accounts/details` item → canonical partial. */
export function mapAccountDetailsItem(
  detail: CerebroAccountDetails,
  ctx: { refreshAt: Date },
): CerebroRestMappedRecord | null {
  const accountId = detail.account?.salesforceAccountId;
  if (!accountId) return null;

  const customerState = detail.customerState;
  const risks = customerState?.risks;
  const riskCategory = normalizeRiskCategory(risks?.riskCategory);
  const riskAnalysis = composeCerebroOverallAssessmentNarrative(detail, risks);
  const cerebroRisks = mapHealthSignals(customerState?.healthRisks);

  const customerName = detail.account?.accountName ?? null;
  const indexedAt =
    risks?.asOfDate ?? customerState?.asOfDate ?? detail.asOfDate ?? null;

  const deepLink = `https://cerebro.na.zuora.com/salesforce/accounts/${accountId}/health`;
  const sourceLink: SourceLink = {
    source: 'cerebro',
    label: 'Cerebro Health Risk',
    url: deepLink,
  };

  const patch: Partial<CanonicalAccount> = {
    cerebroRisks,
    sourceLinks: [sourceLink],
    lastFetchedFromSource: { cerebro: ctx.refreshAt.toISOString() },
  };
  if (riskCategory) patch.cerebroRiskCategory = riskCategory;
  if (riskAnalysis) patch.cerebroRiskAnalysis = riskAnalysis;

  return {
    accountId,
    customerName,
    cerebroIndexedAt: indexedAt,
    patch,
  };
}

export function mapCerebroHealthRecord(
  raw: CerebroHealthRiskRecord,
  ctx: { refreshAt: Date; salesforceAccountId: string },
): CerebroRestMappedRecord | null {
  const flat = flattenRecord(raw);
  const accountId =
    pickString(flat, 'crSalesforceAccountId', 'salesforceAccountId') ??
    ctx.salesforceAccountId;
  if (!accountId) return null;

  const risks: CerebroRisks = {
    utilizationRisk: parseBool(flat.crUtilizationRisk as boolean | string),
    engagementRisk: parseBool(flat.crEngagementRisk as boolean | string),
    suiteRisk: parseBool(flat.crSuiteRisk as boolean | string),
    shareRisk: parseBool(flat.crShareRisk as boolean | string),
    legacyTechRisk: parseBool(flat.crLegacyTechRisk as boolean | string),
    expertiseRisk: parseBool(flat.crExpertiseRisk as boolean | string),
    pricingRisk: parseBool(flat.crPricingRisk as boolean | string),
  };

  const subMetrics: Record<string, number | string | boolean | null> = {};
  for (const k of INT_METRICS) {
    const n = pickNumber(flat, k);
    if (n !== null) subMetrics[k] = n;
  }
  for (const k of BOOL_METRICS) {
    const b = parseBool(flat[k] as boolean | string);
    if (b !== null) subMetrics[k] = b;
  }

  const riskCategory = normalizeRiskCategory(
    flat.crRiskCategory ?? flat.riskCategory,
  );
  const riskAnalysis =
    pickString(flat, 'crRiskAnalysis', 'riskAnalysis') ??
    pickString(flat, 'crRiskCategoryRationale', 'riskCategoryRationale') ??
    null;

  const customerName = pickString(flat, 'crCustomerName', 'customerName');
  const indexedAt =
    pickString(flat, 'updatedAt', 'updateTime') ?? null;

  const deepLink =
    pickString(flat, 'url') ??
    `https://cerebro.na.zuora.com/salesforce/accounts/${accountId}/health`;

  const sourceLink: SourceLink = {
    source: 'cerebro',
    label: 'Cerebro Health Risk',
    url: deepLink,
  };

  const patch: Partial<CanonicalAccount> = {
    cerebroRisks: risks,
    cerebroSubMetrics: subMetrics,
    sourceLinks: [sourceLink],
    lastFetchedFromSource: { cerebro: ctx.refreshAt.toISOString() },
  };
  if (riskCategory) patch.cerebroRiskCategory = riskCategory;
  if (riskAnalysis) patch.cerebroRiskAnalysis = riskAnalysis;

  return {
    accountId,
    customerName,
    cerebroIndexedAt: indexedAt,
    patch,
  };
}
