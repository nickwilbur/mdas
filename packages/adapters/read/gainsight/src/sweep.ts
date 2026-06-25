// Franchise-wide Gainsight CTA fetch via a small number of Glean searches.

import type { GleanClient, GleanDocument } from '../../_shared/src/glean.js';

/** Glean MCP queries tried in order until docs are found. */
export const GAINSIGHT_SWEEP_QUERIES = [
  'gainsight calltoaction CTA',
  'gainsight CTA',
] as const;

const DEFAULT_SWEEP_MAX_PAGES = 15;

export function isGainsightDocument(doc: GleanDocument): boolean {
  return (
    doc.datasource === 'gainsight' ||
    doc.matchingFilters?.app?.includes('gainsight') === true ||
    (doc.url ?? '').includes('gainsight')
  );
}

export function resolveGainsightSweepMaxPages(): number {
  const n = Number(process.env.GAINSIGHT_SWEEP_MAX_PAGES);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_SWEEP_MAX_PAGES;
}

/**
 * Paginated franchise sweep — replaces ~N per-account searches with
 * O(queries × pages) calls. MCP ignores facetFilters; client-side
 * datasource filter applies after fetch.
 */
export async function fetchGainsightCtaDocuments(
  client: GleanClient,
): Promise<{ docs: GleanDocument[]; searchCalls: number }> {
  const maxPages = resolveGainsightSweepMaxPages();
  const seenUrls = new Set<string>();
  const docs: GleanDocument[] = [];
  let searchCalls = 0;

  for (const query of GAINSIGHT_SWEEP_QUERIES) {
    const batch = await client.searchAll({ query }, maxPages);
    searchCalls += 1;
    for (const doc of batch) {
      if (!isGainsightDocument(doc)) continue;
      if (doc.url) {
        if (seenUrls.has(doc.url)) continue;
        seenUrls.add(doc.url);
      }
      docs.push(doc);
    }
    if (docs.length > 0) break;
  }

  return { docs, searchCalls };
}
