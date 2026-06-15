// Live Cerebro Engage drill-down for account pages (server-side only).

import {
  CerebroRestClient,
  readCerebroCredsFromEnv,
} from '@mdas/adapter-cerebro-rest';

export interface CerebroTeamMember {
  name: string;
  email: string | null;
  role: string;
}

export interface CerebroAccountIntel {
  ok: boolean;
  unavailableReason?: string;
  engageHealthUrl?: string;
  engageCatalystsUrl?: string;
  summary?: {
    headline: string | null;
    whatChanged: string[];
    suggestedFocus: string[];
    risksAndConcerns: string[];
    asOfDate: string | null;
  };
  team?: CerebroTeamMember[];
  engagement?: {
    level: string;
    totalEvents: number;
    latestEngagementDate: string | null;
    topTypes: { type: string; count: number }[];
    recentEvents: { date: string; type: string; score: number | null }[];
  };
}

function engageBaseUrl(credsBase: string): string {
  if (credsBase.includes('localhost')) return credsBase.replace(/\/$/, '');
  return 'https://cerebro.corpdata.zuora.com';
}

export async function fetchCerebroAccountIntel(
  salesforceAccountId: string,
): Promise<CerebroAccountIntel | null> {
  const creds = readCerebroCredsFromEnv();
  if (!creds) return null;

  const sfId = salesforceAccountId.trim();
  if (!sfId) return null;

  const client = new CerebroRestClient(creds, { timeoutMs: 15_000 });
  const engage = engageBaseUrl(creds.baseUrl);

  try {
    const [detailsResult, engagementResult] = await Promise.all([
      client.postAccountDetails([sfId]),
      client.getEngagementSummary(sfId).catch(() => null),
    ]);

    const detail = detailsResult.data.items[0];
    if (!detail) {
      return {
        ok: false,
        unavailableReason:
          'Account not found in Cerebro Engage (no access, non-customer, or invalid ID).',
      };
    }

    const summaryBlock = detail.summary;
    const teamBlock = detail.team;

    const intel: CerebroAccountIntel = {
      ok: true,
      engageHealthUrl: `https://cerebro.na.zuora.com/salesforce/accounts/${sfId}/health`,
      engageCatalystsUrl: `${engage}/account/${sfId}/catalysts`,
    };

    if (summaryBlock) {
      intel.summary = {
        headline: summaryBlock.headline ?? null,
        whatChanged: summaryBlock.whatChanged ?? [],
        suggestedFocus: summaryBlock.suggestedFocus ?? [],
        risksAndConcerns: summaryBlock.risksAndConcerns ?? [],
        asOfDate: summaryBlock.asOfDate ?? null,
      };
    }

    if (teamBlock?.members?.length) {
      intel.team = teamBlock.members.map((m) => ({
        name: m.user?.name ?? 'Unknown',
        email: m.user?.email ?? null,
        role: m.role ?? 'member',
      }));
    }

    const eng = engagementResult?.data;
    if (eng) {
      intel.engagement = {
        level: eng.engagementLevel ?? 'unknown',
        totalEvents: eng.totalEvents ?? 0,
        latestEngagementDate: eng.latestEngagementDate ?? null,
        topTypes: (eng.topEngagementTypes ?? []).map((t) => ({
          type: t.engagementType ?? 'Unknown',
          count: t.eventCount ?? 0,
        })),
        recentEvents: (eng.recentEvents ?? []).slice(0, 5).map((e) => ({
          date: e.engagementDate ?? '',
          type: e.engagementType ?? '',
          score: e.score ?? null,
        })),
      };
    }

    return intel;
  } catch (err) {
    return {
      ok: false,
      unavailableReason: (err as Error).message,
    };
  }
}
