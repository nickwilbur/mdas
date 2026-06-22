import 'server-only';
import type { AccountView } from '@mdas/canonical';
import { fetchAccountContext } from '@mdas/adapter-glean-mcp';
import { GleanClient } from '@mdas/adapter-shared/glean';
import { resolveGleanCredsForRequest } from '@/lib/auth';
import { fetchCerebroAccountIntel } from '@/lib/cerebro-account-intel';
import { query } from '@mdas/db';

export interface RemoteCollectorContext {
  cerebroIntel: Awaited<ReturnType<typeof fetchCerebroAccountIntel>>;
  gleanContext: {
    planLinks: { title: string; url: string; lastModified: string }[];
    knowledgeSnippets: { title: string; url: string; snippet: string; observedAt: string }[];
  } | null;
  slackContext: {
    channelUrl: string | null;
    channelMapped: boolean;
    recentMentions: { title: string; url: string; observedAt: string; snippet: string }[];
  } | null;
}

async function loadSlackMapping(accountId: string): Promise<{ channelUrl: string | null; mapped: boolean }> {
  const r = await query<{ slack_channel_url: string | null; status: string }>(
    `SELECT slack_channel_url, status FROM customer_slack_mapping WHERE account_id = $1 LIMIT 1`,
    [accountId],
  );
  const row = r.rows[0];
  if (!row) return { channelUrl: null, mapped: false };
  return {
    channelUrl: row.slack_channel_url,
    mapped: row.status === 'ok' || row.status === 'override',
  };
}

export async function fetchRemoteCollectorContext(
  view: AccountView,
  req?: Request,
): Promise<RemoteCollectorContext> {
  const a = view.account;
  const sfId = a.salesforceAccountId || a.accountId;

  const [cerebroIntel, slackMapping] = await Promise.all([
    fetchCerebroAccountIntel(sfId).catch(() => null),
    loadSlackMapping(a.accountId).catch(() => ({ channelUrl: null, mapped: false })),
  ]);

  let gleanContext: RemoteCollectorContext['gleanContext'] = null;
  let slackMentions: RemoteCollectorContext['slackContext'] = {
    channelUrl: slackMapping.channelUrl ?? a.salesforceSlackChannelUrl ?? null,
    channelMapped: slackMapping.mapped || Boolean(a.salesforceSlackChannelUrl),
    recentMentions: [],
  };

  try {
    const { creds } = await resolveGleanCredsForRequest(req ?? new Request('http://local'));
    const client = new GleanClient(creds);

    const ctx = await fetchAccountContext(client, {
      accountId: a.accountId,
      accountName: a.accountName,
      priorPlanLinks: a.accountPlanLinks?.length ?? 0,
    });

    const knowledgeSnippets: NonNullable<RemoteCollectorContext['gleanContext']>['knowledgeSnippets'] = [];
    const search = await client.search({
      query: `${a.accountName} renewal customer success`,
      pageSize: 5,
    });
    for (const doc of search.documents ?? search.results ?? []) {
      if (!doc.url) continue;
      knowledgeSnippets.push({
        title: doc.title ?? 'Glean result',
        url: doc.url,
        snippet: (doc.snippets?.[0] ?? '').slice(0, 200),
        observedAt: doc.updateTime ?? doc.createTime ?? new Date().toISOString(),
      });
    }

    gleanContext = {
      planLinks: ctx.accountPlanLinks,
      knowledgeSnippets,
    };

    const slackSearch = await client.search({
      query: a.accountName.split(/\s+/)[0] ?? a.accountName,
      pageSize: 3,
    });
    for (const doc of slackSearch.documents ?? slackSearch.results ?? []) {
      if (!doc.url) continue;
      slackMentions.recentMentions.push({
        title: doc.title ?? 'Slack mention',
        url: doc.url,
        snippet: (doc.snippets?.[0] ?? '').slice(0, 160),
        observedAt: doc.updateTime ?? doc.createTime ?? new Date().toISOString(),
      });
    }
  } catch {
    gleanContext = a.accountPlanLinks?.length
      ? { planLinks: a.accountPlanLinks, knowledgeSnippets: [] }
      : null;
  }

  return { cerebroIntel, gleanContext, slackContext: slackMentions };
}
