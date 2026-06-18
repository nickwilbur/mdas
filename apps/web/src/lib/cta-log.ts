import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ctaLogPath } from './cta-project-root';

export type CTAStatus = 'open' | 'closed_done' | 'stalled';

export interface CTALogRecord {
  cta_id: string;
  status?: string;
  closed_at?: string | null;
  last_checked_at?: string | null;
  [key: string]: unknown;
}

function readAllLines(): CTALogRecord[] {
  const path = ctaLogPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as CTALogRecord;
      } catch {
        return null;
      }
    })
    .filter((e): e is CTALogRecord => e != null && Boolean(e.cta_id));
}

/**
 * Update status for a CTA in expand3_cta_log.jsonl (rewrites the matching line).
 */
export function updateCtaStatus(
  ctaId: string,
  status: CTAStatus,
): { ok: true; entry: CTALogRecord } | { ok: false; error: string } {
  const path = ctaLogPath();
  if (!existsSync(path)) {
    return { ok: false, error: 'CTA log not found' };
  }

  const lines = readFileSync(path, 'utf-8').split('\n');
  let found = false;
  let updatedEntry: CTALogRecord | null = null;

  const newLines: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as CTALogRecord;
      if (entry.cta_id !== ctaId) {
        newLines.push(line);
        continue;
      }
      found = true;
      updatedEntry = {
        ...entry,
        status,
        closed_at: status === 'closed_done' ? new Date().toISOString() : null,
        last_checked_at: new Date().toISOString(),
      };
      newLines.push(JSON.stringify(updatedEntry));
    } catch {
      newLines.push(line);
    }
  }

  if (!found || !updatedEntry) {
    return { ok: false, error: 'CTA not found' };
  }

  writeFileSync(path, `${newLines.join('\n')}\n`, 'utf-8');
  return { ok: true, entry: updatedEntry };
}
