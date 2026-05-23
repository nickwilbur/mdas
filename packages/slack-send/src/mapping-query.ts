// Pure SQL builder for `listMappings` filtering + sorting.
//
// This module never touches a DB connection — it returns a SQL WHERE
// clause, ORDER BY clause, and the parameter array. Lives in
// @mdas/slack-send (not apps/web) so it can be unit-tested without
// spinning up Postgres.
//
// Critical safety properties (asserted by tests):
//
//   1. The sort column comes from a server-side WHITELIST. We NEVER
//      interpolate a column name from user input directly into SQL —
//      that's the textbook SQL-injection vector for ORDER BY (which
//      doesn't accept bind parameters). Unknown sort columns silently
//      fall back to the default; the API does not echo user-controlled
//      strings into the SQL.
//
//   2. The sort direction is restricted to 'asc' | 'desc'. Anything
//      else falls back to 'asc'.
//
//   3. All filter VALUES are bound via $N placeholders. No filter value
//      is ever string-concatenated into the SQL text.
//
//   4. Filter COLUMN names are also whitelisted (a misconfigured caller
//      can't request `WHERE password = $1`).
//
//   5. The ORDER BY always carries a `account_id` tiebreaker. Postgres
//      sort is not stable by default, so without a tiebreaker the same
//      page query can return rows in different orders across refreshes
//      when many rows share the sort key (e.g. status='mapped'). This
//      causes rows to "jump" between pages.

export type SortColumn =
  | 'account_name'
  | 'account_id'
  | 'status'
  | 'source'
  | 'slack_channel_id'
  | 'channel_name'
  | 'last_refreshed_at'
  | 'last_validated_at'
  | 'updated_at';

export type SortDir = 'asc' | 'desc';

export const SORTABLE_COLUMNS: ReadonlyArray<SortColumn> = [
  'account_name',
  'account_id',
  'status',
  'source',
  'slack_channel_id',
  'channel_name',
  'last_refreshed_at',
  'last_validated_at',
  'updated_at',
];

const SORTABLE_SET = new Set<string>(SORTABLE_COLUMNS);

export const DEFAULT_SORT: SortColumn = 'account_name';
export const DEFAULT_DIR: SortDir = 'asc';

export interface MappingFilters {
  /** Restrict to a single status (whitelisted enum). */
  status?: string;
  /** Restrict to a single source (whitelisted enum). */
  source?: string;
  /** Substring match across account_name + account_id. */
  q?: string;
  /** Substring match on slack_channel_id (case-insensitive). */
  channelIdQ?: string;
  /** Substring match on channel_name (case-insensitive). */
  channelNameQ?: string;
  /** ISO timestamp; only rows with last_refreshed_at >= this. */
  refreshedAfter?: string;
  /** ISO timestamp; only rows with last_refreshed_at <= this. */
  refreshedBefore?: string;
}

export interface MappingSort {
  sort?: string;
  dir?: string;
}

export interface BuiltQuery {
  /** "WHERE ..." or empty string. */
  whereSql: string;
  /** "ORDER BY <col> <dir>, account_id <dir>" — always non-empty. */
  orderBySql: string;
  /** Bound parameters in $1, $2, ... order. */
  params: unknown[];
  /** The sort column actually used (after whitelist fallback). */
  sortColumn: SortColumn;
  /** The sort direction actually used. */
  sortDir: SortDir;
}

// Statuses recognised by the mapping resolver. Anything else falls
// through the filter (no rows returned with bogus statuses anyway).
export const VALID_MAPPING_STATUSES: ReadonlySet<string> = new Set([
  'mapped',
  'manually_overridden',
  'missing_salesforce_channel',
  'invalid_slack_url',
  'inaccessible_channel',
  'unresolved',
  'heuristic_candidate',
]);

// Source values legal in the DB CHECK constraint plus 'heuristic' which
// is used at runtime even though it's not in the original CHECK.
// Kept here as the UI-facing list.
export const VALID_MAPPING_SOURCES: ReadonlySet<string> = new Set([
  'salesforce',
  'override',
  'sheet',
  'heuristic',
  'cache',
]);

/**
 * Build the WHERE + ORDER BY for `SELECT ... FROM customer_slack_mapping`.
 * See the module docstring for safety guarantees.
 */
export function buildMappingQuery(
  filters: MappingFilters,
  sort: MappingSort,
): BuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.status && VALID_MAPPING_STATUSES.has(filters.status)) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }

  if (filters.source && VALID_MAPPING_SOURCES.has(filters.source)) {
    params.push(filters.source);
    where.push(`source = $${params.length}`);
  }

  if (filters.q && filters.q.trim()) {
    params.push(`%${filters.q.trim()}%`);
    where.push(
      `(account_name ILIKE $${params.length} OR account_id ILIKE $${params.length})`,
    );
  }

  if (filters.channelIdQ && filters.channelIdQ.trim()) {
    params.push(`%${filters.channelIdQ.trim()}%`);
    where.push(`slack_channel_id ILIKE $${params.length}`);
  }

  if (filters.channelNameQ && filters.channelNameQ.trim()) {
    params.push(`%${filters.channelNameQ.trim()}%`);
    where.push(`channel_name ILIKE $${params.length}`);
  }

  // Date-range filters use TIMESTAMPTZ comparison; the caller is
  // expected to pass an ISO-8601 string ("2026-05-22T00:00:00Z" or
  // "2026-05-22"). Postgres parses either.
  if (filters.refreshedAfter && filters.refreshedAfter.trim()) {
    params.push(filters.refreshedAfter.trim());
    where.push(`last_refreshed_at >= $${params.length}::timestamptz`);
  }
  if (filters.refreshedBefore && filters.refreshedBefore.trim()) {
    params.push(filters.refreshedBefore.trim());
    where.push(`last_refreshed_at <= $${params.length}::timestamptz`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Whitelist sort column. Unknown column → fall back to default.
  // This is the SQL-injection critical path: ORDER BY doesn't accept
  // bind parameters, so any user input here MUST come from the
  // whitelist.
  const sortColumn: SortColumn = SORTABLE_SET.has(sort.sort ?? '')
    ? (sort.sort as SortColumn)
    : DEFAULT_SORT;

  // Whitelist direction.
  const lowered = (sort.dir ?? '').toLowerCase();
  const sortDir: SortDir = lowered === 'desc' ? 'desc' : DEFAULT_DIR;

  // NULLS LAST for ascending, NULLS FIRST for descending — keeps blank
  // rows out of the eyeline regardless of direction. account_id is the
  // stable tiebreaker (PK, never null) and uses the same direction so
  // tie-broken rows remain in a consistent block order.
  const nulls = sortDir === 'asc' ? 'NULLS LAST' : 'NULLS FIRST';
  const orderBySql =
    sortColumn === 'account_id'
      ? `ORDER BY account_id ${sortDir}`
      : `ORDER BY ${sortColumn} ${sortDir} ${nulls}, account_id ${sortDir}`;

  return { whereSql, orderBySql, params, sortColumn, sortDir };
}
