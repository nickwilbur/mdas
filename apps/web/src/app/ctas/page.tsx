import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { CTABoard, type CTAEntry, GenerateCTAsButton } from '@/components/CTABoard';
import { parseScanMarkdown, generateSlackMessage, type RichCTA } from '@/lib/cta-utils';
import { getDashboardData } from '@/lib/read-model';
import { buildAccountHoverContextMap } from '@/lib/cta-account-context';

export const dynamic = 'force-dynamic';

// ── Data loading ───────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(process.cwd(), '../..');

function loadCTAData(): { ctas: CTAEntry[]; slackMessages: Record<string, string> } {
  const ctas: CTAEntry[] = [];
  const slackMessages: Record<string, string> = {};
  const richMap = new Map<string, RichCTA>();
  const slackMap = new Map<string, string>();

  // 1. Parse the latest scan markdown only (one generation at a time)
  const scanFiles = readdirSync(PROJECT_ROOT)
    .filter((f) => f.startsWith('expand3_cta_scan_') && f.endsWith('.md'))
    .sort()
    .reverse();
  const latestScan = scanFiles[0];
  if (latestScan) {
    const content = readFileSync(join(PROJECT_ROOT, latestScan), 'utf-8');
    const { richCTAs, slackMessages: msgs } = parseScanMarkdown(content);
    for (const [id, cta] of richCTAs) richMap.set(id, cta);
    for (const [id, msg] of msgs) slackMap.set(id, msg);
  }

  // 2. Read the JSONL tracking log — two kinds of entry:
  //    a) Rich entries (have account_name) — written by generate-ctas.ts,
  //       these are the durable data store and can populate richMap.
  //    b) Tracking stubs (no account_name) — old-format status-only entries,
  //       used only to overlay status onto rich CTAs.
  const jsonlPath = join(PROJECT_ROOT, 'expand3_cta_log.jsonl');
  const statusMap = new Map<string, Record<string, unknown>>();
  if (existsSync(jsonlPath)) {
    const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        statusMap.set(entry.cta_id, entry);
        // Rich JSONL entries (have account_name) backfill richMap when
        // scan MD is deleted or missing.  Scan MD still wins if present.
        if (entry.account_name && !richMap.has(entry.cta_id)) {
          richMap.set(entry.cta_id, entry as RichCTA);
        }
      } catch {
        continue;
      }
    }
  }

  // 3. Merge: only entries in richMap (from scan MD or rich JSONL) render
  //    as cards. Tracking stubs without account_name are never shown.
  const allIds = new Set([...richMap.keys(), ...statusMap.keys()]);
  for (const id of allIds) {
    const rich = richMap.get(id);
    const tracking = statusMap.get(id) as Record<string, unknown> | undefined;

    // Skip entries without rich data — no account_name means nothing to show
    if (!rich) continue;

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

    const ae =
      (rich?.ae as CTAEntry['ae']) ??
      allOwners.find((o) => o.role === 'AE') ??
      null;
    const cse =
      (rich?.cse as CTAEntry['cse']) ??
      allOwners.find((o) => o.role === 'CSE') ??
      null;
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
      destination_slack_channel:
        rich?.destination_slack_channel ??
        (tracking?.destination_slack_channel as string | null) ??
        null,
      renewal_opportunity_url:
        rich?.renewal_opportunity_url ??
        (tracking?.renewal_opportunity_url as string | null) ??
        null,
      drivers: rich?.drivers,
      requested_action: rich?.requested_action,
      deadline:
        rich?.deadline ?? (tracking?.deadline as string) ?? '',
      check_back_date:
        rich?.check_back_date ??
        rich?.follow_through?.check_back_date ??
        (tracking?.check_back_date as string) ??
        '',
      expected_artifact:
        rich?.expected_artifact ??
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
      situation_read: rich?.situation_read ?? null,
      point_of_view: rich?.point_of_view ?? null,
      atr_at_risk_usd: rich?.atr_at_risk_usd ?? null,
      renewal_opportunity_name: rich?.renewal_opportunity_name ?? null,
    };
    ctas.push(entry);
    if (slackMap.has(id)) {
      slackMessages[id] = slackMap.get(id)!;
    } else if (rich) {
      // Auto-generate Slack message from CTA data
      slackMessages[id] = generateSlackMessage(rich);
    }
  }

  // Sort: Red before Yellow before Green, then by deadline ascending
  ctas.sort((a, b) => {
    const riskOrder: Record<string, number> = {
      '🔴': 0, Red: 0,
      '🟡': 1, Yellow: 1,
      '🟢': 2, Green: 2,
    };
    const ra = riskOrder[a.risk_color] ?? 3;
    const rb = riskOrder[b.risk_color] ?? 3;
    if (ra !== rb) return ra - rb;
    return a.deadline.localeCompare(b.deadline);
  });

  return { ctas, slackMessages };
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function CTAsPage() {
  const { ctas, slackMessages } = loadCTAData();
  const { views } = await getDashboardData();
  const accountContexts = buildAccountHoverContextMap(views);

  if (ctas.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-semibold">Churn-Risk CTAs</h1>
          <GenerateCTAsButton />
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <div className="mx-auto max-w-md space-y-3">
            <p className="text-4xl">📋</p>
            <p className="text-sm font-medium text-gray-900">No CTAs generated yet</p>
            <p className="text-xs text-gray-500">
              Click <strong>Generate CTAs</strong> above or run{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                /expand3-cta-generator scan
              </code>{' '}
              in Cascade to scan all 224 Expand 3 accounts.
            </p>
          </div>
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
        <GenerateCTAsButton />
      </div>
      <CTABoard ctas={ctas} slackMessages={slackMessages} accountContexts={accountContexts} />
    </div>
  );
}
