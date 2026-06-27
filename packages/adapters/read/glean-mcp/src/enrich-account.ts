import type { CanonicalAccount } from '@mdas/canonical';
import type { GleanClient } from '../../_shared/src/glean.js';
import { fetchAccountContext } from './account-context.js';
import {
  applyContextAndEvidenceToAccount,
  fetchAccountEvidence,
} from './evidence.js';

export async function enrichGleanMcpAccount(
  client: GleanClient,
  account: CanonicalAccount,
  refreshAt: Date,
): Promise<Partial<CanonicalAccount> | null> {
  const input = {
    accountId: account.accountId,
    accountName: account.accountName,
    salesforceSlackChannelUrl: account.salesforceSlackChannelUrl,
    priorPlanLinks: account.accountPlanLinks?.length ?? 0,
  };
  const [context, evidence] = await Promise.all([
    fetchAccountContext(client, input),
    fetchAccountEvidence(client, input),
  ]);
  const patch: Partial<CanonicalAccount> = { accountId: account.accountId };
  applyContextAndEvidenceToAccount(
    patch,
    context,
    evidence,
    refreshAt,
    account.recentMeetings,
  );
  return patch;
}
