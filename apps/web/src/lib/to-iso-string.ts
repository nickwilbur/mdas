/**
 * Coerce a timestamp value of unknown shape into an ISO 8601 string.
 *
 * pg hydrates `timestamptz` columns to JS `Date` by default even
 * though our `RefreshRun` TypeScript interface narrows the field to
 * `string` (the JSON-serialized representation the API consumes).
 * Direct DB-query consumers (like the trajectory loader) thus get
 * `Date` at runtime; serialized consumers get `string`. This helper
 * makes both paths converge on a single ISO string format.
 *
 * Anything else (number, null, undefined) falls back to `new Date()`
 * → ISO; safer than throwing because the trajectory loader is
 * non-critical and we'd rather skip a malformed row than 500.
 */
export function toIsoString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const parsed = new Date(v);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : v;
  }
  if (typeof v === 'number') return new Date(v).toISOString();
  return new Date().toISOString();
}
