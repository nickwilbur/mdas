import type { SourceLink } from './index.js';

/** Dedupe citation links by URL; later entries win on label conflicts. */
export function dedupeSourceLinksByUrl(
  existing: SourceLink[] | undefined,
  next?: SourceLink[] | undefined,
): SourceLink[] {
  const byUrl = new Map<string, SourceLink>();
  for (const link of existing ?? []) {
    if (link.url) byUrl.set(link.url, link);
  }
  for (const link of next ?? []) {
    if (link.url) byUrl.set(link.url, link);
  }
  return [...byUrl.values()];
}
