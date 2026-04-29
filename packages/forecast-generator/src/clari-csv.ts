// Clari-paste CSV exporter and dark-account detector.
//
// Audit ref: §4.7 (Phase 3 PR-C3).
//
// Manager paste-flow: copy the CSV from MDAS → paste into Clari's
// "import opportunities" grid. The column set matches Clari's
// minimal accepted import schema (Account, Opportunity, Close Date,
// ACV, Forecast Most Likely, Confidence, Stage, Owner Notes) so the
// paste lands without manual remap. Extra columns Clari ignores
// (Risk Score, Bucket) are intentionally suffixed so a manager
// reviewing the CSV in Excel still sees the MDAS context.
//
// Quoting rules (RFC 4180):
//   - Wrap every cell in double quotes.
//   - Double any embedded double quote.
//   - Use \r\n line endings (Excel-friendly).
//
// We deliberately do NOT use a library here — the format is
// trivial and a dep would dominate the package's size budget.
import type { AccountView } from '@mdas/canonical';

const CLARI_COLUMNS = [
  'Account',
  'Opportunity',
  'Close Date',
  'ACV',
  'Forecast Most Likely',
  'Confidence',
  'Stage',
  'Bucket',
  'Risk Score',
  'Days to Renewal',
  'CSE',
  'SC Next Steps',
] as const;

function csvEscape(v: unknown): string {
  if (v == null) return '""';
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export interface ClariCsvOptions {
  /**
   * If true (default), only opportunities with type Renewal/Upsell/
   * Cross-Sell are included. If false, every opp is exported.
   */
  forecastableOnly?: boolean;
}

export function generateClariCsv(
  views: AccountView[],
  options: ClariCsvOptions = {},
): string {
  const { forecastableOnly = true } = options;
  const rows: string[] = [];
  rows.push(CLARI_COLUMNS.map((c) => csvEscape(c)).join(','));

  for (const v of views) {
    for (const opp of v.opportunities) {
      if (forecastableOnly) {
        if (!/^(renewal|upsell|cross-sell)$/i.test(opp.type)) continue;
      }
      rows.push(
        [
          v.account.accountName,
          opp.opportunityName,
          opp.closeDate ?? '',
          // Forecast columns are numeric in Clari; emit empty for null
          // so Excel doesn't display "0" where the data was unknown.
          opp.acv ?? '',
          opp.forecastMostLikelyOverride ?? opp.forecastMostLikely ?? '',
          opp.mostLikelyConfidence ?? '',
          opp.stageName ?? '',
          v.bucket,
          v.riskScore ? `${v.riskScore.score} (${v.riskScore.band})` : '',
          v.daysToRenewal ?? '',
          v.account.assignedCSE?.name ?? '',
          (opp.scNextSteps ?? '').replace(/\s+/g, ' ').trim(),
        ]
          .map(csvEscape)
          .join(','),
      );
    }
  }
  return rows.join('\r\n');
}

// ----- Dark accounts (§4.7) -----
//
// "Dark" = no signal of customer-facing activity in the last
// `windowDays` (default 7). Specifically:
//   - no recentMeetings within the window,
//   - no workshops with workshopDate within the window,
//   - sentiment commentary not updated within the window.
//
// Dark accounts are surfaced as a headline counter in the markdown
// generator and as a separate "Dark Accounts" section so a manager
// notices when an account in their book has gone silent before the
// renewal window opens.

const DAY = 86_400_000;

export interface DarkAccount {
  accountId: string;
  accountName: string;
  daysSinceLastSignal: number;
  reason: string;
  arr: number;
}

export function findDarkAccounts(
  views: AccountView[],
  options: { windowDays?: number; now?: number } = {},
): DarkAccount[] {
  const { windowDays = 7, now = Date.now() } = options;
  const cutoff = now - windowDays * DAY;
  const out: DarkAccount[] = [];
  for (const v of views) {
    // Skip Confirmed Churn — they are by definition "done", not dark.
    if (v.bucket === 'Confirmed Churn') continue;

    const meetingTimes = v.account.recentMeetings
      .map((m) => Date.parse(m.startTime ?? ''))
      .filter((t) => Number.isFinite(t));
    const workshopTimes = v.account.workshops
      .map((w) => Date.parse(w.workshopDate ?? ''))
      .filter((t) => Number.isFinite(t));
    const sentimentT = v.account.cseSentimentCommentaryLastUpdated
      ? Date.parse(v.account.cseSentimentCommentaryLastUpdated)
      : Number.NEGATIVE_INFINITY;
    const lastSignal = Math.max(
      sentimentT,
      ...(meetingTimes.length ? meetingTimes : [Number.NEGATIVE_INFINITY]),
      ...(workshopTimes.length ? workshopTimes : [Number.NEGATIVE_INFINITY]),
    );
    if (lastSignal >= cutoff) continue;
    const days = Number.isFinite(lastSignal)
      ? Math.floor((now - lastSignal) / DAY)
      : Number.POSITIVE_INFINITY;
    const reason = !Number.isFinite(lastSignal)
      ? 'no recorded customer signal'
      : `${days}d since last signal`;
    out.push({
      accountId: v.account.accountId,
      accountName: v.account.accountName,
      daysSinceLastSignal: Number.isFinite(days) ? days : -1,
      reason,
      arr: v.account.allTimeARR ?? 0,
    });
  }
  // ARR-exposed first so the manager's eye lands on the largest book.
  out.sort((a, b) => b.arr - a.arr);
  return out;
}
