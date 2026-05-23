import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIR,
  DEFAULT_SORT,
  SORTABLE_COLUMNS,
  buildMappingQuery,
} from './mapping-query.js';

describe('buildMappingQuery — defaults', () => {
  it('returns empty WHERE + default ORDER BY when no filters/sort', () => {
    const q = buildMappingQuery({}, {});
    expect(q.whereSql).toBe('');
    expect(q.params).toEqual([]);
    expect(q.sortColumn).toBe(DEFAULT_SORT);
    expect(q.sortDir).toBe(DEFAULT_DIR);
    // Default is account_name asc with account_id tiebreaker.
    expect(q.orderBySql).toBe(
      'ORDER BY account_name asc NULLS LAST, account_id asc',
    );
  });
});

describe('buildMappingQuery — filters', () => {
  it('binds status as parameter and adds the WHERE fragment', () => {
    const q = buildMappingQuery({ status: 'mapped' }, {});
    expect(q.whereSql).toBe('WHERE status = $1');
    expect(q.params).toEqual(['mapped']);
  });

  it('silently drops bogus status (whitelist enforced)', () => {
    const q = buildMappingQuery({ status: 'totally_made_up' }, {});
    expect(q.whereSql).toBe('');
    expect(q.params).toEqual([]);
  });

  it('binds source as parameter', () => {
    const q = buildMappingQuery({ source: 'override' }, {});
    expect(q.whereSql).toBe('WHERE source = $1');
    expect(q.params).toEqual(['override']);
  });

  it('drops bogus source', () => {
    const q = buildMappingQuery({ source: 'pwned' }, {});
    expect(q.whereSql).toBe('');
  });

  it('builds q as a single ILIKE param matching both account_name and account_id', () => {
    const q = buildMappingQuery({ q: 'acme' }, {});
    expect(q.whereSql).toBe(
      'WHERE (account_name ILIKE $1 OR account_id ILIKE $1)',
    );
    expect(q.params).toEqual(['%acme%']);
  });

  it('trims q whitespace', () => {
    const q = buildMappingQuery({ q: '  acme  ' }, {});
    expect(q.params).toEqual(['%acme%']);
  });

  it('ignores empty q', () => {
    const q = buildMappingQuery({ q: '   ' }, {});
    expect(q.whereSql).toBe('');
  });

  it('escapes nothing on its own — the % wrap is intentional, but values are still BOUND not interpolated', () => {
    // The bind parameter contains the literal user input wrapped in %...%
    // — Postgres binds it as a string value, so injection via the
    // user-supplied portion is impossible. This test documents that
    // the value is whatever the user typed (we don't mangle their %).
    const q = buildMappingQuery({ q: "'; DROP TABLE customers; --" }, {});
    expect(q.params).toEqual(["%'; DROP TABLE customers; --%"]);
    // Critical: the SQL TEXT itself never contains the user input.
    expect(q.whereSql).not.toContain('DROP');
  });

  it('combines multiple filters with AND and incrementing $N', () => {
    const q = buildMappingQuery(
      {
        status: 'mapped',
        source: 'salesforce',
        q: 'acme',
        channelIdQ: 'C123',
        channelNameQ: 'cust-acme',
      },
      {},
    );
    expect(q.whereSql).toBe(
      'WHERE status = $1 AND source = $2 AND (account_name ILIKE $3 OR account_id ILIKE $3) AND slack_channel_id ILIKE $4 AND channel_name ILIKE $5',
    );
    expect(q.params).toEqual(['mapped', 'salesforce', '%acme%', '%C123%', '%cust-acme%']);
  });

  it('handles refreshedAfter / refreshedBefore with ::timestamptz cast', () => {
    const q = buildMappingQuery(
      { refreshedAfter: '2026-01-01', refreshedBefore: '2026-12-31' },
      {},
    );
    expect(q.whereSql).toBe(
      'WHERE last_refreshed_at >= $1::timestamptz AND last_refreshed_at <= $2::timestamptz',
    );
    expect(q.params).toEqual(['2026-01-01', '2026-12-31']);
  });
});

describe('buildMappingQuery — sort whitelist (SQL-injection prevention)', () => {
  it('falls back to default for an unknown sort column', () => {
    // CRITICAL: an unknown column must NOT be interpolated into the
    // ORDER BY. The fallback to the default sort is what prevents
    // injection via ?sort=name%20DESC;DROP%20TABLE.
    const q = buildMappingQuery(
      {},
      { sort: 'name; DROP TABLE customer_slack_mapping --' },
    );
    expect(q.sortColumn).toBe(DEFAULT_SORT);
    expect(q.orderBySql).toBe(
      'ORDER BY account_name asc NULLS LAST, account_id asc',
    );
    expect(q.orderBySql).not.toContain('DROP');
  });

  it('accepts every column in SORTABLE_COLUMNS', () => {
    for (const col of SORTABLE_COLUMNS) {
      const q = buildMappingQuery({}, { sort: col });
      expect(q.sortColumn).toBe(col);
      expect(q.orderBySql).toContain(col);
    }
  });

  it('falls back to asc for unknown direction', () => {
    const q = buildMappingQuery({}, { dir: 'foo; DROP TABLE x --' });
    expect(q.sortDir).toBe('asc');
    expect(q.orderBySql.endsWith(' asc')).toBe(true);
  });

  it('accepts desc (case-insensitive)', () => {
    expect(buildMappingQuery({}, { dir: 'desc' }).sortDir).toBe('desc');
    expect(buildMappingQuery({}, { dir: 'DESC' }).sortDir).toBe('desc');
    expect(buildMappingQuery({}, { dir: 'Desc' }).sortDir).toBe('desc');
  });

  it('uses NULLS FIRST for desc, NULLS LAST for asc', () => {
    const asc = buildMappingQuery({}, { sort: 'last_refreshed_at', dir: 'asc' });
    const desc = buildMappingQuery({}, { sort: 'last_refreshed_at', dir: 'desc' });
    expect(asc.orderBySql).toContain('NULLS LAST');
    expect(desc.orderBySql).toContain('NULLS FIRST');
  });

  it('account_id sort has no secondary tiebreaker (it IS the PK)', () => {
    const q = buildMappingQuery({}, { sort: 'account_id', dir: 'desc' });
    expect(q.orderBySql).toBe('ORDER BY account_id desc');
  });
});
