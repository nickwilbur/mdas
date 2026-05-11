import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { CTABoard, type CTAEntry } from '@/components/CTABoard';

export const dynamic = 'force-dynamic';

// ── Data loading ───────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(process.cwd(), '../..');

interface RichCTA {
  cta_id: string;
  account_name: string;
  salesforce_account_id: string | null;
  play_type: string;
  risk_color: string;
  primary_owner: { name: string; slack_handle: string; role: string } | string;
  cc_owners?: { name: string; slack_handle: string; role: string }[];
  destination_slack_channel?: string | null;
  renewal_opportunity_url?: string | null;
  drivers?: string[];
  requested_action?: string;
  deadline: string;
  follow_through?: {
    expected_artifact: string;
    check_back_date: string;
    auto_check_query: string;
    escalation_owner: string;
    escalation_trigger: string;
  };
  data_gaps?: string[];
  cse_sentiment_commentary?: string | null;
  commentary_last_updated?: string | null;
  team_aware?: boolean;
}

function parseScanMarkdown(content: string): {
  richCTAs: Map<string, RichCTA>;
  slackMessages: Map<string, string>;
} {
  const richCTAs = new Map<string, RichCTA>();
  const slackMessages = new Map<string, string>();

  // Split into CTA sections by ### headers
  const sections = content.split(/^### /m).slice(1);

  for (const section of sections) {
    // Extract JSON block
    const jsonMatch = section.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!jsonMatch) continue;

    let parsed: RichCTA;
    try {
      parsed = JSON.parse(jsonMatch[1] ?? '{}');
    } catch {
      continue;
    }
    if (!parsed.cta_id) continue;

    richCTAs.set(parsed.cta_id, parsed);

    // Extract Slack message — text after the closing ``` and before the next ---
    const matchIdx = jsonMatch.index ?? 0;
    const afterJson = section.slice(matchIdx + jsonMatch[0].length);
    const slackText = (afterJson.split('---')[0] ?? '')
      .trim()
      .replace(/\n{2,}/g, '\n');
    if (slackText) {
      slackMessages.set(parsed.cta_id, slackText);
    }
  }

  return { richCTAs, slackMessages };
}

function loadCTAData(): { ctas: CTAEntry[]; slackMessages: Record<string, string> } {
  const ctas: CTAEntry[] = [];
  const slackMessages: Record<string, string> = {};
  const richMap = new Map<string, RichCTA>();
  const slackMap = new Map<string, string>();

  // 1. Parse all scan markdown files for rich CTA data + Slack messages
  const scanFiles = readdirSync(PROJECT_ROOT).filter(
    (f) => f.startsWith('expand3_cta_scan_') && f.endsWith('.md'),
  );
  for (const file of scanFiles) {
    const content = readFileSync(join(PROJECT_ROOT, file), 'utf-8');
    const { richCTAs, slackMessages: msgs } = parseScanMarkdown(content);
    for (const [id, cta] of richCTAs) richMap.set(id, cta);
    for (const [id, msg] of msgs) slackMap.set(id, msg);
  }

  // 2. Read the JSONL tracking log for status data
  const jsonlPath = join(PROJECT_ROOT, 'expand3_cta_log.jsonl');
  const statusMap = new Map<string, Record<string, unknown>>();
  if (existsSync(jsonlPath)) {
    const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        statusMap.set(entry.cta_id, entry);
      } catch {
        continue;
      }
    }
  }

  // 3. Merge: rich data takes priority, JSONL provides status tracking
  const allIds = new Set([...richMap.keys(), ...statusMap.keys()]);
  for (const id of allIds) {
    const rich = richMap.get(id);
    const tracking = statusMap.get(id) as Record<string, unknown> | undefined;

    const ownerFromRich = rich?.primary_owner;
    const ownerName =
      typeof ownerFromRich === 'object' && ownerFromRich
        ? ownerFromRich.name
        : (tracking?.primary_owner as string) ?? 'Unknown';

    // Extract team members by role
    const allOwners = [
      ...(typeof ownerFromRich === 'object' && ownerFromRich ? [ownerFromRich] : []),
      ...(rich?.cc_owners ?? []),
    ];

    const ae = allOwners.find((o) => o.role === 'AE') ?? null;
    const cse = allOwners.find((o) => o.role === 'CSE') ?? null;
    const tam = allOwners.find((o) => o.role === 'TAM') ?? null;
    const esa = allOwners.find((o) => o.role === 'ESA') ?? null;

    const entry: CTAEntry = {
      cta_id: id,
      account_name:
        rich?.account_name ?? (tracking?.account_name as string) ?? 'Unknown',
      salesforce_account_id:
        rich?.salesforce_account_id ??
        (tracking?.salesforce_account_id as string | null) ??
        null,
      play_type: rich?.play_type ?? (tracking?.play_type as string) ?? 'unknown',
      risk_color: rich?.risk_color ?? (tracking?.risk_color as string) ?? '🟢',
      primary_owner: rich?.primary_owner ?? ownerName,
      cc_owners: rich?.cc_owners,
      destination_slack_channel: rich?.destination_slack_channel ?? null,
      renewal_opportunity_url: rich?.renewal_opportunity_url ?? null,
      drivers: rich?.drivers,
      requested_action: rich?.requested_action,
      deadline:
        rich?.deadline ?? (tracking?.deadline as string) ?? '',
      check_back_date:
        rich?.follow_through?.check_back_date ??
        (tracking?.check_back_date as string) ??
        '',
      expected_artifact:
        rich?.follow_through?.expected_artifact ??
        (tracking?.expected_artifact as string) ??
        '',
      follow_through: rich?.follow_through,
      data_gaps: rich?.data_gaps,
      posted_at: (tracking?.posted_at as string) ?? '',
      posted_to_channel: (tracking?.posted_to_channel as string) ?? 'dry-run',
      status: (tracking?.status as string) ?? 'open',
      last_checked_at: (tracking?.last_checked_at as string | null) ?? null,
      escalation_message_id:
        (tracking?.escalation_message_id as string | null) ?? null,
      ae,
      cse,
      tam,
      esa,
      cse_sentiment_commentary: rich?.cse_sentiment_commentary ?? null,
      commentary_last_updated: rich?.commentary_last_updated ?? null,
      team_aware: Boolean(rich?.team_aware),
    };
    ctas.push(entry);
    if (slackMap.has(id)) {
      slackMessages[id] = slackMap.get(id)!;
    }
  }

  // Sort: 🔴 before 🟡 before 🟢, then by deadline ascending
  ctas.sort((a, b) => {
    const riskOrder: Record<string, number> = { '🔴': 0, '🟡': 1, '🟢': 2 };
    const ra = riskOrder[a.risk_color] ?? 3;
    const rb = riskOrder[b.risk_color] ?? 3;
    if (ra !== rb) return ra - rb;
    return a.deadline.localeCompare(b.deadline);
  });

  return { ctas, slackMessages };
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CTAsPage() {
  const { ctas, slackMessages } = loadCTAData();

  if (ctas.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Churn-Risk CTAs</h1>
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-600">
            No CTAs generated yet. Run{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">
              /expand3-cta-generator scan
            </code>{' '}
            to generate your first batch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Churn-Risk CTAs</h1>
          <p className="text-xs text-gray-500">
            Expand 3 — generated from Cerebro, SFDC, and Glean signals
          </p>
        </div>
      </div>
      <CTABoard ctas={ctas} slackMessages={slackMessages} />
    </div>
  );
}
