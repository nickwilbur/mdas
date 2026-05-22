// Server-only Slack mapping service.
//
// Responsibilities:
//   - Read durable mappings from customer_slack_mapping
//   - Refresh mappings (full or single) from the latest snapshot_account
//     payloads (which carry salesforceSlackChannelUrl from the SFDC
//     adapter) plus any manual overrides
//   - Record write/refresh audit events
//
// Reads use the read-only @mdas/db query helper. The refresh writes UPSERT
// rows into customer_slack_mapping — a NEW table for this feature, not a
// snapshot table — so it does not violate the snapshot-immutability
// invariant from the rest of the codebase.

import 'server-only';
import { query, audit, latestSuccessfulRun } from '@mdas/db';
import {
  computeMappingStatus,
  fetchPublicChannelIndex,
  parseSlackUrl,
  readSendGateConfigFromEnv,
  slugifyAccountName,
  validateChannelId,
  EMPTY_INDEX,
  type ChannelIndex,
  type ChannelValidation,
  type MappingStatus,
  type MappingSource,
} from '@mdas/slack-send';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const ENTERPRISE_HOST = 'zuora.enterprise.slack.com';

// Cap conversations.info calls per refresh. Slack Tier-3 nominal limit
// is ~50/minute; we stay well below to leave headroom for other tooling.
// Validations cost ~1s round-trip; 40 = ~40s added per full refresh in
// the worst case, and the next refresh picks up where this one left off.
const MAX_VALIDATIONS_PER_REFRESH = 40;

function buildChannelUrl(channelId: string): string {
  return `https://${ENTERPRISE_HOST}/archives/${channelId}`;
}
import type { CanonicalAccount } from '@mdas/canonical';

export interface SlackMappingRow {
  accountId: string;
  accountName: string | null;
  slackUrl: string | null;
  slackChannelId: string | null;
  /** Human-readable channel name. Populated for every row when derivable. */
  channelName: string | null;
  /** 'slack-api' (verified) | 'convention' (cust-{slug}) | null. */
  channelNameSource: 'slack-api' | 'convention' | null;
  /** True when Slack API reports the channel archived; null when unknown. */
  isArchived: boolean | null;
  /** Provenance of the URL above. The UI shows this as a badge. */
  source: MappingSource;
  status: MappingStatus;
  statusReason: string | null;
  /** For heuristic source: the cust-{slug} candidate channel name. */
  derivedChannelName: string | null;
  notes: string | null;
  lastRefreshedAt: string;
  lastValidatedAt: string | null;
  updatedBy: string;
  updatedAt: string;
  // Enrichment from latest snapshot — present after a successful refresh.
  franchise?: string | null;
  assignedCSE?: string | null;
  accountOwner?: string | null;
}

interface MappingDbRow {
  account_id: string;
  account_name: string | null;
  slack_url: string | null;
  slack_channel_id: string | null;
  channel_name: string | null;
  channel_name_source: 'slack-api' | 'convention' | null;
  is_archived: boolean | null;
  source: MappingSource;
  status: MappingStatus;
  status_reason: string | null;
  derived_channel_name: string | null;
  notes: string | null;
  last_refreshed_at: string;
  last_validated_at: string | null;
  updated_by: string;
  updated_at: string;
}

function rowToMapping(r: MappingDbRow): SlackMappingRow {
  return {
    accountId: r.account_id,
    accountName: r.account_name,
    slackUrl: r.slack_url,
    slackChannelId: r.slack_channel_id,
    channelName: r.channel_name,
    channelNameSource: r.channel_name_source,
    isArchived: r.is_archived,
    source: r.source,
    status: r.status,
    statusReason: r.status_reason,
    derivedChannelName: r.derived_channel_name,
    notes: r.notes,
    lastRefreshedAt: r.last_refreshed_at,
    lastValidatedAt: r.last_validated_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

export interface ListMappingsOptions {
  /** 1-indexed page number. Default 1. */
  page?: number;
  /** Rows per page. Default 50, capped at 200. */
  pageSize?: number;
  /** Restrict to a single status. */
  status?: string;
  /** Case-insensitive substring match on account_name OR account_id. */
  q?: string;
}

export interface ListMappingsResult {
  rows: SlackMappingRow[];
  total: number;
  /** Status histogram across the FULL (unfiltered) result set — for UI tiles. */
  counts: Record<string, number>;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 200;
const VALID_STATUSES = new Set([
  'mapped',
  'manually_overridden',
  'missing_salesforce_channel',
  'invalid_slack_url',
  'inaccessible_channel',
  'unresolved',
  'heuristic_candidate',
]);

export async function listMappings(
  opts: ListMappingsOptions = {},
): Promise<ListMappingsResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  // Build WHERE clause with parameterized values. Status is whitelisted
  // (not concatenated raw) and `q` is bound via ILIKE — never interpolated.
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status && VALID_STATUSES.has(opts.status)) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  if (opts.q && opts.q.trim()) {
    params.push(`%${opts.q.trim()}%`);
    where.push(`(account_name ILIKE $${params.length} OR account_id ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Three queries in parallel:
  //   1. The page slice
  //   2. The filtered total (for pagination)
  //   3. The full-set status histogram (for the UI tiles — unaffected by
  //      the user's status filter so they always see the population shape)
  const pageSliceQuery = query<MappingDbRow>(
    `SELECT * FROM customer_slack_mapping ${whereSql}
       ORDER BY account_name NULLS LAST, account_id
       LIMIT ${pageSize} OFFSET ${offset}`,
    params,
  );
  const filteredTotalQuery = query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM customer_slack_mapping ${whereSql}`,
    params,
  );
  const fullCountsQuery = query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM customer_slack_mapping GROUP BY status`,
  );

  const [pageSliceRes, filteredTotalRes, fullCountsRes] = await Promise.all([
    pageSliceQuery,
    filteredTotalQuery,
    fullCountsQuery,
  ]);

  const base = pageSliceRes.rows.map(rowToMapping);

  // Enrich only the visible page from the snapshot — fetch by account_id
  // list, not the full ~346-account payload set. This is the actual
  // browser-memory win: at 50/page the response payload is ~50 rows
  // regardless of total account count.
  const run = await latestSuccessfulRun();
  let enriched = base;
  if (run && base.length > 0) {
    const ids = base.map((r) => r.accountId);
    const accts = await query<{ payload: CanonicalAccount }>(
      `SELECT payload FROM snapshot_account
         WHERE refresh_id = $1 AND account_id = ANY($2::text[])`,
      [run.id, ids],
    );
    const byId = new Map(accts.rows.map((x) => [x.payload.accountId, x.payload]));
    enriched = base.map((m) => {
      const a = byId.get(m.accountId);
      if (!a) return m;
      return {
        ...m,
        franchise: a.franchise ?? null,
        assignedCSE: a.assignedCSE?.name ?? null,
        accountOwner: a.accountOwner?.name ?? null,
      };
    });
  }

  const counts: Record<string, number> = {};
  for (const r of fullCountsRes.rows) counts[r.status] = Number(r.count);

  return {
    rows: enriched,
    total: Number(filteredTotalRes.rows[0]?.count ?? 0),
    counts,
    page,
    pageSize,
  };
}

export async function getMapping(accountId: string): Promise<SlackMappingRow | null> {
  const r = await query<MappingDbRow>(
    `SELECT * FROM customer_slack_mapping WHERE account_id = $1`,
    [accountId],
  );
  return r.rows[0] ? rowToMapping(r.rows[0]) : null;
}

export interface RefreshSummary {
  total: number;
  mapped: number;
  manually_overridden: number;
  missing_salesforce_channel: number;
  invalid_slack_url: number;
  inaccessible_channel: number;
  unresolved: number;
  heuristic_candidate: number;
  changed: number;
  /** Channels we called conversations.info on during this refresh. */
  validated: number;
  /** Validation calls that threw (network / 5xx). Recorded but non-fatal. */
  validationErrors: number;
  refreshedAt: string;
}

/**
 * Refresh the mapping for every Expand-3 account currently in the latest
 * snapshot, or a single account when accountId is provided.
 *
 * Idempotent: re-running with the same upstream state produces the same
 * row contents (timestamps update; status/url do not flip-flop).
 *
 * Source priority enforced here:
 *   override (existing row with source='override') >
 *   salesforce (current snapshot value) >
 *   cache (existing row's previous slack_url)
 *
 * Manual overrides are preserved across refreshes by keeping any row whose
 * existing source='override' and re-running computeMappingStatus with the
 * stored override URL as overrideUrl.
 */
export async function refreshMappings(opts: {
  actor: string;
  accountId?: string;
}): Promise<RefreshSummary> {
  const actor = opts.actor || 'manual:nick';
  const run = await latestSuccessfulRun();
  if (!run) {
    await audit(actor, 'slack.mapping.refresh.skipped', { reason: 'no-successful-run' });
    return emptySummary();
  }

  const accountsRes = await query<{ payload: CanonicalAccount }>(
    opts.accountId
      ? `SELECT payload FROM snapshot_account WHERE refresh_id = $1 AND account_id = $2`
      : `SELECT payload FROM snapshot_account WHERE refresh_id = $1`,
    opts.accountId ? [run.id, opts.accountId] : [run.id],
  );
  const accounts = accountsRes.rows
    .map((r) => r.payload)
    .filter((a) => a.franchise === 'Expand 3');

  const existingRes = await query<MappingDbRow>(
    opts.accountId
      ? `SELECT * FROM customer_slack_mapping WHERE account_id = $1`
      : `SELECT * FROM customer_slack_mapping`,
    opts.accountId ? [opts.accountId] : [],
  );
  const existingByAccount = new Map(existingRes.rows.map((r) => [r.account_id, r]));

  // Sheet-imported URLs, keyed by accountId. Loaded once per refresh.
  // Empty when no sheet has been imported yet — that's the normal state
  // for a fresh install.
  const sheetRes = await query<{ account_id: string; slack_url: string }>(
    opts.accountId
      ? `SELECT account_id, slack_url FROM customer_slack_mapping_sheet WHERE account_id = $1`
      : `SELECT account_id, slack_url FROM customer_slack_mapping_sheet`,
    opts.accountId ? [opts.accountId] : [],
  );
  const sheetByAccount = new Map(sheetRes.rows.map((r) => [r.account_id, r.slack_url]));

  // Read-only Slack channel index. One conversations.list pass per
  // refresh (no `chat.postMessage`, no `conversations.join` — bot is
  // never asked to join any channel). When no bot token is configured
  // we proceed with EMPTY_INDEX; convention names still get written
  // and heuristic candidates remain unresolved.
  const gate = readSendGateConfigFromEnv();
  let channelIndex: ChannelIndex = EMPTY_INDEX;
  let channelIndexError: string | null = null;
  if (gate.readAuth) {
    try {
      channelIndex = await fetchPublicChannelIndex({
        readToken: gate.readAuth.token,
        readCookie: gate.readAuth.cookie,
      });
    } catch (e) {
      channelIndexError = (e as Error).message;
    }
  }

  await audit(actor, 'slack.mapping.refresh.start', {
    scope: opts.accountId ?? 'all',
    refreshId: run.id,
    accountCount: accounts.length,
    sheetRows: sheetByAccount.size,
    slackIndex: {
      fetched: channelIndex.fetched,
      total: channelIndex.total,
      error: channelIndexError,
    },
  });

  const summary: RefreshSummary = emptySummary();
  summary.total = accounts.length;
  summary.refreshedAt = new Date().toISOString();

  // Budget across the whole refresh — first-come-first-served. Rows we
  // don't validate this pass will be picked up by the next refresh.
  let validationBudgetRemaining = MAX_VALIDATIONS_PER_REFRESH;

  for (const a of accounts) {
    const existing = existingByAccount.get(a.accountId);
    // Manual override only honored when the existing row was explicitly set
    // by an admin (source='override'). Other historical source values
    // ('cache', 'sheet', 'heuristic', 'salesforce') are NOT carried as
    // "cachedUrl" if they hold a heuristic candidate (no real URL); we
    // only treat them as cache when they actually carry a slack_url.
    const overrideUrl = existing?.source === 'override' ? existing.slack_url : null;
    const salesforceUrl = a.salesforceSlackChannelUrl ?? null;
    const sheetUrl = sheetByAccount.get(a.accountId) ?? null;
    const cachedUrl =
      existing && existing.source !== 'override' && existing.slack_url
        ? existing.slack_url
        : null;
    const heuristicCandidateName = slugifyAccountName(a.accountName);
    const knownInaccessible = existing?.status === 'inaccessible_channel';

    const result = computeMappingStatus({
      salesforceUrl,
      overrideUrl,
      sheetUrl,
      cachedUrl,
      heuristicCandidateName,
      knownInaccessible,
    });

    // ---------- Channel-name + URL post-processing ----------
    //
    // Goal: every row carries BOTH a name AND a URL whenever derivable,
    // regardless of source. Resolution rules:
    //
    //   1. If the status produced a real channel id (Cxxx), look up the
    //      real name in the Slack index. Match found → use real name +
    //      (Slack-reported archive flag). Match not found AND we have
    //      a bot token AND we haven't already reached a sticky terminal
    //      state → call conversations.info to disambiguate (live but
    //      private, archived, or actually inaccessible/dead).
    //
    //   2. If the status is heuristic_candidate (no URL, just a name)
    //      AND the candidate name resolves to a public channel id in
    //      the index → PROMOTE: set slack_url, slack_channel_id,
    //      status=mapped (source stays 'heuristic' so the UI shows
    //      provenance).
    //
    //   3. Otherwise the row keeps whatever URL the status step
    //      produced (which may be null) and the convention name as
    //      the channel name.
    //
    // Sticky terminal states (NOT re-validated):
    //   - status='inaccessible_channel'  (Slack reported dead)
    //   - is_archived = true             (already known archived)
    //
    // The next refresh's heuristic pass may still discover a NEW
    // replacement channel by name lookup — so terminal-state stickiness
    // doesn't prevent re-mapping a customer onto a fresh channel.
    let slackUrl = result.slackUrl;
    let slackChannelId = result.slackChannelId;
    let status: MappingStatus = result.status;
    let statusReason = result.statusReason;
    let channelName: string | null = heuristicCandidateName;
    let channelNameSource: 'slack-api' | 'convention' | null =
      heuristicCandidateName ? 'convention' : null;
    let isArchived: boolean | null = null;
    let lastValidatedAt: Date | null = null;

    // Sticky terminal state — carry forward and skip validation.
    const stickyArchived = existing?.is_archived === true;
    const stickyInaccessible = existing?.status === 'inaccessible_channel';
    // "Recently validated live" — skip re-validation for 24h so the
    // bounded per-refresh budget rotates through pending rows instead
    // of re-validating the same 40 channels every refresh. Without
    // this, channels late in the iteration order (e.g. 66degrees)
    // never get reached.
    const RECENT_VALIDATION_MS = 24 * 60 * 60 * 1000;
    const recentlyValidatedLive =
      !!existing?.last_validated_at &&
      Date.now() - new Date(existing.last_validated_at).getTime() < RECENT_VALIDATION_MS;

    if (slackChannelId) {
      const ch = channelIndex.byId.get(slackChannelId);
      if (ch) {
        channelName = ch.name;
        channelNameSource = 'slack-api';
        isArchived = ch.isArchived;
        lastValidatedAt = new Date();
      } else if (stickyInaccessible) {
        // Carry forward sticky inaccessible — do NOT re-validate.
        status = 'inaccessible_channel';
        statusReason =
          existing!.status_reason ??
          'Previously validated as inaccessible (Slack returned channel_not_found). Once dead, sticky.';
        isArchived = existing!.is_archived;
        channelName = existing!.channel_name ?? heuristicCandidateName;
        channelNameSource = existing!.channel_name_source ?? channelNameSource;
        lastValidatedAt = existing!.last_validated_at
          ? new Date(existing!.last_validated_at)
          : null;
      } else if (stickyArchived) {
        isArchived = true;
        channelName = existing!.channel_name ?? heuristicCandidateName;
        channelNameSource = existing!.channel_name_source ?? channelNameSource;
        lastValidatedAt = existing!.last_validated_at
          ? new Date(existing!.last_validated_at)
          : null;
      } else if (recentlyValidatedLive) {
        // Validated as live within the last 24h — carry the timestamp
        // forward, skip the API call so the budget can reach
        // not-yet-validated rows on this refresh.
        lastValidatedAt = new Date(existing!.last_validated_at!);
        isArchived = existing!.is_archived ?? false;
        channelName = existing!.channel_name ?? heuristicCandidateName;
        channelNameSource = existing!.channel_name_source ?? channelNameSource;
      } else if (gate.readAuth && validationBudgetRemaining > 0) {
        // Not in public index, no sticky state — disambiguate via API.
        validationBudgetRemaining--;
        // Rate-limit gate for xoxc: ~250ms between calls + jitter, so
        // the access pattern looks closer to a human browsing Slack
        // than to a script. Bot/user tokens skip the delay (they're
        // sanctioned API clients).
        if (gate.readAuth.kind === 'xoxc') {
          await sleep(250 + Math.floor(Math.random() * 250));
        }
        try {
          const v: ChannelValidation = await validateChannelId({
            readToken: gate.readAuth.token,
            readCookie: gate.readAuth.cookie,
            channelId: slackChannelId,
          });
          lastValidatedAt = new Date();
          if (v.state === 'live') {
            isArchived = v.isArchived;
            // Name still convention here — conversations.info gives a
            // name field, but we deliberately keep this loop tight and
            // only use the bulk index for name lookups. (Could be
            // enhanced later.)
          } else if (v.state === 'inaccessible') {
            status = 'inaccessible_channel';
            statusReason =
              `Slack API reports channel ${slackChannelId} is inaccessible (${v.slackError}). Likely dead, deleted, or wrong-workspace.`;
          } else if (v.state === 'private') {
            // Private to the bot — leave status alone (mapped if it was
            // mapped); we just can't fetch metadata for it. UI shows
            // the URL + convention name.
            statusReason =
              `Slack reports channel is private to the bot (${v.slackError}); URL preserved, name not verified.`;
          } else {
            statusReason =
              `Slack API validation returned unknown error: ${v.slackError}. URL preserved.`;
          }
          summary.validated++;
        } catch (e) {
          summary.validationErrors++;
        }
      }
      // else: no bot token or budget exhausted — preserve URL, convention name
    } else if (result.status === 'heuristic_candidate' && result.derivedChannelName) {
      // Try to promote heuristic candidate via name lookup in the index.
      const ch = channelIndex.byName.get(result.derivedChannelName);
      if (ch && !ch.isArchived) {
        slackChannelId = ch.id;
        slackUrl = buildChannelUrl(ch.id);
        channelName = ch.name;
        channelNameSource = 'slack-api';
        isArchived = false;
        status = 'mapped';
        statusReason =
          `Resolved via Slack public-channel directory using the cust-{slug} convention (no Salesforce/sheet/override value).`;
      } else if (ch && ch.isArchived) {
        // Found by name but archived — keep candidate status, surface
        // archived flag so the UI can warn.
        channelName = ch.name;
        channelNameSource = 'slack-api';
        isArchived = true;
        statusReason =
          `Slack channel "${ch.name}" matches the convention but is archived; mark as candidate until a current channel is identified.`;
      }
    }

    summary[status]++;
    if (
      !existing ||
      existing.slack_url !== slackUrl ||
      existing.status !== status ||
      existing.source !== result.source ||
      existing.channel_name !== channelName ||
      existing.is_archived !== isArchived ||
      existing.derived_channel_name !== (result.derivedChannelName ?? null)
    ) {
      summary.changed++;
    }

    await query(
      `INSERT INTO customer_slack_mapping
         (account_id, account_name, slack_url, slack_channel_id, source,
          status, status_reason, derived_channel_name,
          channel_name, channel_name_source, is_archived,
          last_refreshed_at, last_validated_at, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12,$13,NOW())
       ON CONFLICT (account_id) DO UPDATE SET
         account_name = EXCLUDED.account_name,
         slack_url = EXCLUDED.slack_url,
         slack_channel_id = EXCLUDED.slack_channel_id,
         source = EXCLUDED.source,
         status = EXCLUDED.status,
         status_reason = EXCLUDED.status_reason,
         derived_channel_name = EXCLUDED.derived_channel_name,
         channel_name = EXCLUDED.channel_name,
         channel_name_source = EXCLUDED.channel_name_source,
         is_archived = EXCLUDED.is_archived,
         last_refreshed_at = NOW(),
         last_validated_at = COALESCE(EXCLUDED.last_validated_at,
                                      customer_slack_mapping.last_validated_at),
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        a.accountId,
        a.accountName,
        slackUrl,
        slackChannelId,
        result.source,
        status,
        statusReason,
        result.derivedChannelName ?? null,
        channelName,
        channelNameSource,
        isArchived,
        lastValidatedAt,
        actor,
      ],
    );
  }

  await audit(actor, 'slack.mapping.refresh.complete', summary);
  return summary;
}

function emptySummary(): RefreshSummary {
  return {
    total: 0,
    mapped: 0,
    manually_overridden: 0,
    missing_salesforce_channel: 0,
    invalid_slack_url: 0,
    inaccessible_channel: 0,
    unresolved: 0,
    heuristic_candidate: 0,
    changed: 0,
    validated: 0,
    validationErrors: 0,
    refreshedAt: new Date().toISOString(),
  };
}

// ---------- Sheet import (admin paste-in / CSV) ----------
//
// Operational tracker spreadsheets are the LAST RESORT source per the
// spec. The codebase forbids auto-scraping gdrive sheets via Glean
// (see README "Glean is a backup and enrichment source, never primary"
// and the explicit gdrive-out-of-scope rule). So the only supported
// path is an explicit human-driven import: the admin pastes CSV here.
//
// Expected CSV shape (header row required, case-insensitive):
//   account_id,slack_url[,note]
// or
//   accountId,slackUrl[,note]
//
// Account names alone are NOT accepted — the import requires the SFDC
// 18-char account id so we can join unambiguously.

export interface SheetImportRow {
  accountId: string;
  slackUrl: string;
  note?: string;
}

export interface SheetImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export async function importSheetCsv(args: {
  csv: string;
  actor: string;
}): Promise<SheetImportResult> {
  const rows = parseCsv(args.csv);
  if (rows.length === 0) {
    return { imported: 0, skipped: 0, errors: [{ row: 0, reason: 'empty CSV' }] };
  }
  const header = rows[0]!.map((c) => c.trim().toLowerCase());
  const idIdx = header.findIndex((c) => c === 'account_id' || c === 'accountid');
  const urlIdx = header.findIndex((c) => c === 'slack_url' || c === 'slackurl');
  const noteIdx = header.findIndex((c) => c === 'note' || c === 'source_note');
  if (idIdx < 0 || urlIdx < 0) {
    return {
      imported: 0,
      skipped: 0,
      errors: [
        {
          row: 1,
          reason: 'header must include account_id (or accountId) and slack_url (or slackUrl)',
        },
      ],
    };
  }

  const result: SheetImportResult = { imported: 0, skipped: 0, errors: [] };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const accountId = (r[idIdx] ?? '').trim();
    const slackUrl = (r[urlIdx] ?? '').trim();
    const note = noteIdx >= 0 ? (r[noteIdx] ?? '').trim() : '';

    if (!accountId || !slackUrl) {
      result.skipped++;
      continue;
    }

    try {
      await query(
        `INSERT INTO customer_slack_mapping_sheet
           (account_id, slack_url, imported_by, imported_at, source_note)
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (account_id) DO UPDATE SET
           slack_url = EXCLUDED.slack_url,
           imported_by = EXCLUDED.imported_by,
           imported_at = NOW(),
           source_note = EXCLUDED.source_note`,
        [accountId, slackUrl, args.actor, note || null],
      );
      result.imported++;
    } catch (e) {
      result.errors.push({ row: i + 1, reason: (e as Error).message });
    }
  }

  await audit(args.actor, 'slack.mapping.sheet.import', {
    imported: result.imported,
    skipped: result.skipped,
    errorCount: result.errors.length,
  });

  return result;
}

// Minimal CSV parser — handles quoted cells with embedded commas and
// escaped quotes (""). Keeps the slack-send package dependency-free.
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // Treat CRLF and LF identically; eat a following \n after \r.
      row.push(cell);
      cell = '';
      out.push(row);
      row = [];
      if (ch === '\r' && text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  // Drop trailing empty rows.
  while (out.length > 0 && out[out.length - 1]!.every((c) => c === '')) out.pop();
  return out;
}
