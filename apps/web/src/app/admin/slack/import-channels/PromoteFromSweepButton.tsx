'use client';

// Reads data/slack-channels.json (produced by `npm run sweep:slack`)
// via the /api/slack/mappings/promote-from-sweep endpoint, then
// renders the same result panel (counts + per-source breakdown +
// near-match suggestions) the HAR upload uses. Reuses the diagnostic
// surface so the failure modes look identical regardless of input
// channel.

import { useCallback, useState } from 'react';

interface Suggestion {
  accountId: string;
  accountName: string;
  candidateName: string;
  suggestion: { id: string; name: string; isPrivate: boolean; isArchived: boolean };
  score: number;
}

interface SweepFileMeta {
  path: string;
  ranAt: string;
  ageDays: number;
  sizeBytes: number;
}

interface PromoteResult {
  channelsInPaste: number;
  candidatesConsidered: number;
  promoted: number;
  archivedSkipped: number;
  suggestions: Suggestion[];
  diagnostic: {
    sampleCustChannels: string[];
    custChannelCount: number;
    sampleCandidatesWeTried: string[];
  };
  parseError: string | null;
  ranAt: string;
  sweepFile?: SweepFileMeta;
  error?: string;
}

const HOST = 'https://zuora.enterprise.slack.com';

export function PromoteFromSweepButton(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PromoteResult | null>(null);
  const [acceptedAccounts, setAcceptedAccounts] = useState<Set<string>>(new Set());
  const [rejectedAccounts, setRejectedAccounts] = useState<Set<string>>(new Set());

  const run = useCallback(async () => {
    setBusy(true);
    setResult(null);
    setAcceptedAccounts(new Set());
    setRejectedAccounts(new Set());
    try {
      const res = await fetch('/api/slack/mappings/promote-from-sweep', { method: 'POST' });
      const body = (await res.json()) as PromoteResult;
      setResult(body);
    } catch (e) {
      setResult({
        channelsInPaste: 0,
        candidatesConsidered: 0,
        promoted: 0,
        archivedSkipped: 0,
        suggestions: [],
        diagnostic: { sampleCustChannels: [], custChannelCount: 0, sampleCandidatesWeTried: [] },
        parseError: `Network error: ${(e as Error).message}`,
        ranAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const acceptSuggestion = useCallback(async (s: Suggestion) => {
    const url = `${HOST}/archives/${s.suggestion.id}`;
    try {
      const res = await fetch(
        `/api/slack/mappings/override/${encodeURIComponent(s.accountId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slackUrl: url,
            note: `Accepted near-match from sweep (cust-{slug}="${s.candidateName}" → "${s.suggestion.name}", score ${s.score.toFixed(2)})`,
          }),
        },
      );
      const body = (await res.json()) as { ok: boolean; reason?: string };
      if (!body.ok) {
        alert(`Accept failed: ${body.reason ?? 'unknown'}`);
        return;
      }
      setAcceptedAccounts((prev) => new Set(prev).add(s.accountId));
    } catch (e) {
      alert(`Accept failed: ${(e as Error).message}`);
    }
  }, []);

  const rejectSuggestion = useCallback((s: Suggestion) => {
    setRejectedAccounts((prev) => new Set(prev).add(s.accountId));
  }, []);

  const visibleSuggestions = (result?.suggestions ?? []).filter(
    (s) => !acceptedAccounts.has(s.accountId) && !rejectedAccounts.has(s.accountId),
  );

  return (
    <div>
      <button
        onClick={run}
        disabled={busy}
        className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50"
      >
        {busy ? 'Promoting…' : 'Promote from sweep file'}
      </button>

      {result?.error || result?.parseError ? (
        <pre className="mt-3 whitespace-pre-wrap rounded bg-red-50 p-3 text-xs text-red-900">
          {result.error || result.parseError}
        </pre>
      ) : null}

      {result && !result.error && !result.parseError ? (
        <div className="mt-3 space-y-3">
          {result.sweepFile ? (
            <p className="text-xs text-gray-500">
              Sweep file: {result.sweepFile.path} (written{' '}
              {result.sweepFile.ageDays === 0
                ? 'today'
                : `${result.sweepFile.ageDays} day${result.sweepFile.ageDays === 1 ? '' : 's'} ago`}
              , {(result.sweepFile.sizeBytes / 1024).toFixed(1)} KB)
              {result.sweepFile.ageDays > 30 ? (
                <span className="ml-2 text-amber-700">
                  ⚠ stale — consider re-running <code>npm run sweep:slack</code>
                </span>
              ) : null}
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Channels in sweep" value={result.channelsInPaste} />
            <Stat label="Candidates considered" value={result.candidatesConsidered} />
            <Stat
              label="Promoted (exact match)"
              value={result.promoted}
              tone={result.promoted > 0 ? 'good' : 'neutral'}
            />
            <Stat
              label="Archived skipped"
              value={result.archivedSkipped}
              tone={result.archivedSkipped > 0 ? 'warn' : 'neutral'}
            />
          </dl>

          {result.promoted > 0 ? (
            <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              Promoted {result.promoted} row{result.promoted === 1 ? '' : 's'}.{' '}
              <a href="/admin/slack" className="font-semibold underline">
                Back to mappings →
              </a>
            </p>
          ) : null}

          {visibleSuggestions.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium">
                Near-match suggestions ({visibleSuggestions.length} pending review)
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="py-1">Account</th>
                    <th>We tried</th>
                    <th>Suggested</th>
                    <th>Score</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSuggestions.map((s) => (
                    <tr key={s.accountId} className="border-t border-gray-100">
                      <td className="py-1.5">
                        <div className="font-medium">{s.accountName}</div>
                        <div className="font-mono text-xs text-gray-500">{s.accountId}</div>
                      </td>
                      <td className="font-mono text-xs">#{s.candidateName}</td>
                      <td className="font-mono text-xs">
                        #{s.suggestion.name}{' '}
                        {s.suggestion.isPrivate ? (
                          <span className="rounded bg-gray-200 px-1 text-[10px]">private</span>
                        ) : null}
                        {s.suggestion.isArchived ? (
                          <span className="rounded bg-red-100 px-1 text-[10px] text-red-800">
                            archived
                          </span>
                        ) : null}
                      </td>
                      <td className="font-mono text-xs">{s.score.toFixed(2)}</td>
                      <td className="py-1.5">
                        <div className="flex gap-1">
                          <button
                            onClick={() => acceptSuggestion(s)}
                            disabled={s.suggestion.isArchived}
                            className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => rejectSuggestion(s)}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            Skip
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {acceptedAccounts.size > 0 ? (
                <p className="mt-2 text-xs text-emerald-800">
                  ✓ {acceptedAccounts.size} accepted
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'good' | 'warn' | 'neutral';
}): JSX.Element {
  const cls =
    tone === 'good'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-gray-200 bg-white text-gray-800';
  return (
    <div className={`rounded border px-3 py-2 ${cls}`}>
      <div className="text-xs">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
