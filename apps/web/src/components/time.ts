// Pure date-math helpers shared by RelativeTime + FreshnessRow + SourceDots.
// Extracted into a non-component module so they can be unit-tested with
// vitest directly (apps/web has no React testing library wired up, and
// the logic here is the only non-trivial part of the components).

/** Threshold past which a fetched timestamp counts as stale. Mirrors the
 *  product decision in the integration docs: "freshness shown amber after 7d". */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Pure relative-time formatter. Returns the label only — caller is
 *  responsible for emitting the absolute time for hover. */
export function relativeTimeLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return 'in the future';
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Has more than `STALE_AFTER_MS` elapsed since `iso`? */
export function isStale(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() > STALE_AFTER_MS;
}
