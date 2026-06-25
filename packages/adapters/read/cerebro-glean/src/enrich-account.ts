import type { CanonicalAccount } from '@mdas/canonical';
import type { GleanClient, GleanDocument } from '../../_shared/src/glean.js';
import { mapCerebroDocument } from './mapper.js';

export async function searchCerebroDocsForAccount(
  client: GleanClient,
  account: CanonicalAccount,
): Promise<GleanDocument[]> {
  const resp = await client.search({ query: `cerebro ${account.accountName}` });
  const docs = resp.documents ?? resp.results ?? [];
  return docs.filter(
    (d) =>
      d.datasource === 'cerebro' ||
      d.matchingFilters?.app?.includes('cerebro') === true ||
      (d.url ?? '').includes('cerebro'),
  );
}

export function mapCerebroDocsToAccountPartials(
  docs: GleanDocument[],
  refreshAt: Date,
): CanonicalAccount[] {
  const byAccount = new Map<string, CanonicalAccount>();
  const seenUrls = new Set<string>();
  for (const doc of docs) {
    if (doc.url) {
      if (seenUrls.has(doc.url)) continue;
      seenUrls.add(doc.url);
    }
    const rec = mapCerebroDocument(doc, { refreshAt });
    if (!rec) continue;
    const existing = byAccount.get(rec.accountId);
    const partial: Partial<CanonicalAccount> = existing
      ? { ...existing, ...rec.patch }
      : rec.patch;
    byAccount.set(rec.accountId, {
      ...(partial as CanonicalAccount),
      accountId: rec.accountId,
    });
  }
  return Array.from(byAccount.values());
}
