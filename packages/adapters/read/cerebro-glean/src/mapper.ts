// Cerebro → canonical mapper.
//
// Source: Glean documents from app:cerebro, type:healthrisk. Each document
// is one Cerebro Health Risk page, keyed by SFDC Account ID. The Glean
// index exposes:
//   - 7 risk booleans (Engagement / Expertise / LegacyTech / Pricing /
//     Share / Suite / Utilization Risk)
//   - sub-metrics (Projected Billing/Revenue Utilization %, Executive
//     Meeting Count, Billing/Revenue Product Share %, Orders API Usage %,
//     ePayments / Invoices Posted / Quotes counts, etc.)
//   - has-flags (Enhanced Services, ESA, Invoice Settlement, MS, PES, TAM, UNO)
//
// What Glean does NOT expose for Cerebro (verified 2026-04-28 via mcp2_search
// + mcp2_read_document): Risk Category (Low/Medium/High/Critical) and Risk
// Analysis prose. Those fields appear to live in a curated weekly Google
// Sheet ("Cerebro Accounts with NASE") which is a separate retrieval path
// (PR-4.b future work). This mapper therefore leaves cerebroRiskCategory
// and cerebroRiskAnalysis as `undefined` in the partial output so the
// scoring layer's RiskIdentifier { source: 'fallback' } path activates
// per Section 10 of the refactor prompt (the only legitimate place a
// derivation happens).
import type {
  CanonicalAccount,
  CerebroRisks,
  SourceLink,
} from '@mdas/canonical';
import type { GleanDocument } from '../../_shared/src/glean.js';

/**
 * Parse the rich-document JSON payload we get from Glean's getdocument
 * response into a shape with intFacets / keywordFacets sub-objects.
 */
interface CerebroRichContent {
  customFields?: { id: string; text: string }[];
  facets?: {
    keywordFacets?: Record<string, string[]>;
    intFacets?: Record<string, number>;
  };
}

const KW_FALSE = new Set(['false', '0', 'no', 'off']);

function parseBool(values: string[] | undefined): boolean | null {
  if (!values || values.length === 0) return null;
  const v = values[0]?.toLowerCase();
  if (v === undefined) return null;
  return !KW_FALSE.has(v);
}

/** Extract risk booleans from either matchingFilters or richDocumentData. */
function extractRisks(doc: GleanDocument, parsed: CerebroRichContent | null): CerebroRisks {
  const kw = parsed?.facets?.keywordFacets ?? {};
  const mf = doc.matchingFilters ?? {};
  // Prefer richDocumentData (canonical casing); fall back to matchingFilters
  // (lowercase keys per Glean's search response).
  const get = (richKey: string, mfKey: string): boolean | null =>
    parseBool(kw[richKey]) ?? parseBool(mf[mfKey]);
  return {
    utilizationRisk: get('crUtilizationRisk', 'crutilizationrisk'),
    engagementRisk: get('crEngagementRisk', 'crengagementrisk'),
    suiteRisk: get('crSuiteRisk', 'crsuiterisk'),
    shareRisk: get('crShareRisk', 'crsharerisk'),
    legacyTechRisk: get('crLegacyTechRisk', 'crlegacytechrisk'),
    expertiseRisk: get('crExpertiseRisk', 'crexpertiserisk'),
    pricingRisk: get('crPricingRisk', 'crpricingrisk'),
  };
}

/**
 * Cerebro sub-metric field names we care about. The list mirrors the
 * "plus sub-metrics" line in the prompt's Section 6 plus a few additional
 * health indicators visible in Cerebro Health Risk pages.
 */
const SUB_METRIC_INT_FIELDS = [
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

const SUB_METRIC_BOOL_FIELDS = [
  'crHasEnhancedServices',
  'crHasEsa',
  'crHasInvoiceSettlement',
  'crHasMs',
  'crHasPes',
  'crHasTam',
  'crHasUno',
  'crReportingUse',
] as const;

/**
 * Snippets in Glean's MCP `search` response carry the sub-metrics as
 * labeled scalars, e.g.:
 *   "Dso: 0", "Executive Meeting Count: 3",
 *   "Has Invoice Settlement: false", "Revenue Amount: 1234567"
 *
 * Map each snippet → canonical sub-metric key. Returns the parsed value
 * (number for numerics, boolean for has-flags) or null if the snippet
 * doesn't match any known label.
 */
const SNIPPET_LABEL_TO_INT_KEY: Record<string, (typeof SUB_METRIC_INT_FIELDS)[number]> = {
  'Projected Billing Utilization': 'crProjectedBillingUtilization',
  'Projected Revenue Utilization': 'crProjectedRevenueUtilization',
  'Executive Meeting Count': 'crExecutiveMeetingCount',
  'Billing Product Share': 'crBillingProductShare',
  'Revenue Product Share': 'crRevenueProductShare',
  'Orders API Usage': 'crOrdersApiUsage',
  'Emailed Invoices': 'crEmailedInvoices',
  'ePayments Processed': 'crEpaymentsProcessed',
  'Invoices Posted': 'crInvoicesPosted',
  'Journal Entries': 'crJournalEntries',
  Orders: 'crOrders',
  Quotes: 'crQuotes',
  'Revenue Amount': 'crRevenueAmount',
  'Billing Cost': 'crBillingCost',
  'Revenue Cost': 'crRevenueCost',
  Dso: 'crDso',
};

const SNIPPET_LABEL_TO_BOOL_KEY: Record<string, (typeof SUB_METRIC_BOOL_FIELDS)[number]> = {
  'Has Enhanced Services': 'crHasEnhancedServices',
  'Has ESA': 'crHasEsa',
  'Has Invoice Settlement': 'crHasInvoiceSettlement',
  'Has MS': 'crHasMs',
  'Has PES': 'crHasPes',
  'Has TAM': 'crHasTam',
  'Has UNO': 'crHasUno',
  'Reporting Use': 'crReportingUse',
};

function parseSnippetSubMetric(
  snippet: string,
): { key: string; value: number | boolean } | null {
  const m = /^([A-Za-z][A-Za-z\s]+?):\s*(.+?)\s*$/.exec(snippet);
  if (!m) return null;
  const label = m[1]!.trim();
  const value = m[2]!.trim();
  const intKey = SNIPPET_LABEL_TO_INT_KEY[label];
  if (intKey) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return { key: intKey, value: n };
  }
  const boolKey = SNIPPET_LABEL_TO_BOOL_KEY[label];
  if (boolKey) {
    const b = parseBool([value]);
    if (b === null) return null;
    return { key: boolKey, value: b };
  }
  return null;
}

function extractSubMetrics(
  doc: GleanDocument,
  parsed: CerebroRichContent | null,
): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  // Prefer richDocumentData (REST path; canonical-cased keys + intFacets).
  if (parsed?.facets) {
    const intFacets = parsed.facets.intFacets ?? {};
    const kw = parsed.facets.keywordFacets ?? {};
    for (const k of SUB_METRIC_INT_FIELDS) {
      if (k in intFacets) out[k] = intFacets[k] ?? null;
    }
    for (const k of SUB_METRIC_BOOL_FIELDS) {
      const b = parseBool(kw[k]);
      if (b !== null) out[k] = b;
    }
  }
  // Always also harvest from snippets — Glean's MCP `search` tool only
  // surfaces sub-metrics there, and the REST `getdocument` path may
  // return additional values via snippets too. Snippets-derived values
  // never overwrite richDocumentData values.
  for (const snippet of doc.snippets ?? []) {
    const parsedSnippet = parseSnippetSubMetric(snippet);
    if (!parsedSnippet) continue;
    if (!(parsedSnippet.key in out)) {
      out[parsedSnippet.key] = parsedSnippet.value;
    }
  }
  return out;
}

function extractAccountId(doc: GleanDocument, parsed: CerebroRichContent | null): string | null {
  const fromKw = parsed?.facets?.keywordFacets?.['crSalesforceAccountId']?.[0];
  if (fromKw) return fromKw;
  const fromMf = doc.matchingFilters?.['crsalesforceaccountid']?.[0];
  if (fromMf) return fromMf;
  // Fallback: parse from the URL (.../accounts/<sfid>/health)
  if (doc.url) {
    const m = doc.url.match(/\/accounts\/([A-Za-z0-9]+)\//);
    if (m) return m[1] ?? null;
  }
  return null;
}

function extractCustomerName(doc: GleanDocument, parsed: CerebroRichContent | null): string | null {
  const fromKw = parsed?.facets?.keywordFacets?.['crCustomerName']?.[0];
  if (fromKw) return fromKw;
  const fromMf = doc.matchingFilters?.['crcustomername']?.[0];
  if (fromMf) return fromMf;
  return doc.title?.replace(/^Health Risk\s*[—-]\s*/, '') ?? null;
}

function parseRichContent(doc: GleanDocument): CerebroRichContent | null {
  const raw = doc.richDocumentData?.content;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as CerebroRichContent;
  } catch {
    return null;
  }
}

export interface CerebroMappedRecord {
  /** SFDC 18-char or 15-char Account ID — used to merge onto CanonicalAccount. */
  accountId: string;
  /** Customer name as Cerebro reports it (used for cross-check / debugging). */
  customerName: string | null;
  /** Cerebro's last-update timestamp from Glean (ISO 8601). */
  cerebroIndexedAt: string | null;
  patch: Partial<CanonicalAccount>;
}

/**
 * Build the canonical Account partial for one Cerebro Glean document. The
 * caller merges this onto the existing Account record by accountId match.
 */
export function mapCerebroDocument(
  doc: GleanDocument,
  ctx: { refreshAt: Date; deepLinkLabel?: string },
): CerebroMappedRecord | null {
  const parsed = parseRichContent(doc);
  const accountId = extractAccountId(doc, parsed);
  if (!accountId) return null;

  const cerebroRisks = extractRisks(doc, parsed);
  const subMetrics = extractSubMetrics(doc, parsed);
  const customerName = extractCustomerName(doc, parsed);

  const sourceLink: SourceLink = {
    source: 'cerebro',
    label: ctx.deepLinkLabel ?? 'Cerebro Health Risk',
    url: doc.url ?? '',
    ...(doc.citationId ? { citationId: doc.citationId } : {}),
    ...(typeof doc.snippetIndex === 'number' ? { snippetIndex: doc.snippetIndex } : {}),
  };

  const indexedAt = doc.updateTime ?? null;

  // Risk Category and Risk Analysis are intentionally NOT set — Glean's
  // Cerebro datasource does not expose them. Scoring fallback handles the
  // absence.
  const patch: Partial<CanonicalAccount> = {
    cerebroRisks,
    cerebroSubMetrics: subMetrics,
    sourceLinks: [sourceLink],
    lastFetchedFromSource: { cerebro: ctx.refreshAt.toISOString() },
  };

  return { accountId, customerName, cerebroIndexedAt: indexedAt, patch };
}
