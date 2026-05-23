'use client';

import { useCallback, useRef, useState } from 'react';
import { Card } from '@/components/ui';

interface Suggestion {
  accountId: string;
  accountName: string;
  candidateName: string;
  suggestion: { id: string; name: string; isPrivate: boolean; isArchived: boolean };
  score: number;
}

interface HarSource {
  url: string;
  status: number;
  count: number;
}

interface PromoteResult {
  channelsInPaste: number; // misnomer-but-kept: total channels extracted
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
  harSources?: HarSource[];
}

const HOST = 'https://zuora.enterprise.slack.com';

export function ImportChannelsClient(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PromoteResult | null>(null);
  const [acceptedAccounts, setAcceptedAccounts] = useState<Set<string>>(new Set());
  const [rejectedAccounts, setRejectedAccounts] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setAcceptedAccounts(new Set());
    setRejectedAccounts(new Set());
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/slack/mappings/import-har', {
        method: 'POST',
        body: fd,
      });
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
  }, [file]);

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
            note: `Accepted near-match suggestion (cust-{slug}="${s.candidateName}" → channel "${s.suggestion.name}", score ${s.score.toFixed(2)}) via import-channels HAR`,
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

  const onFileSelected = useCallback((f: File | null) => {
    if (!f) {
      setFile(null);
      return;
    }
    if (!/\.har$|\.json$/i.test(f.name)) {
      if (!confirm(`"${f.name}" doesn't look like a .har or .json file. Use it anyway?`)) return;
    }
    setFile(f);
    setResult(null);
  }, []);

  const visibleSuggestions = (result?.suggestions ?? []).filter(
    (s) => !acceptedAccounts.has(s.accountId) && !rejectedAccounts.has(s.accountId),
  );

  return (
    <>
      <Card title="Upload HAR & promote">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0] ?? null;
            onFileSelected(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex h-32 cursor-pointer items-center justify-center rounded border-2 border-dashed text-sm ${
            dragOver
              ? 'border-blue-500 bg-blue-50 text-blue-900'
              : 'border-gray-300 bg-gray-50 text-gray-600 hover:border-gray-400'
          }`}
        >
          {file ? (
            <div className="text-center">
              <div className="font-medium text-gray-900">{file.name}</div>
              <div className="text-xs text-gray-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
              <div className="mt-1 text-xs text-gray-500">Click to choose a different file</div>
            </div>
          ) : (
            <div className="text-center">
              <div>Drag a .har file here, or click to browse</div>
              <div className="mt-1 text-xs text-gray-500">
                Max 100 MB. The file is processed in-memory and never written to disk.
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".har,application/json"
            className="hidden"
            onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || !file}
            className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50"
          >
            {busy ? 'Processing…' : 'Parse HAR & promote exact matches'}
          </button>
          <button
            onClick={() => {
              setFile(null);
              setResult(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            disabled={busy || (!file && !result)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </Card>

      {result?.parseError ? (
        <Card title="Parse error">
          <pre className="whitespace-pre-wrap rounded bg-red-50 p-3 text-xs text-red-900">
            {result.parseError}
          </pre>
        </Card>
      ) : null}

      {result && !result.parseError ? (
        <Card title="Result">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Channels in HAR" value={result.channelsInPaste} />
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

          {result.harSources && result.harSources.length > 0 ? (
            <details className="mt-3 text-xs text-gray-600">
              <summary className="cursor-pointer">
                Channels extracted from {result.harSources.length} Slack endpoint
                {result.harSources.length === 1 ? '' : 's'} in the HAR
              </summary>
              <ul className="ml-5 mt-2 list-disc space-y-0.5">
                {result.harSources
                  .sort((a, b) => b.count - a.count)
                  .map((s, i) => (
                    <li key={i}>
                      <code>{s.url}</code> — {s.count} channel{s.count === 1 ? '' : 's'}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}

          {result.promoted === 0 && result.candidatesConsidered > 0 ? (
            <div className="mt-3 space-y-2 rounded bg-amber-50 px-3 py-3 text-xs text-amber-900">
              <p className="font-semibold">
                No exact matches between what's in the HAR and what we tried.
              </p>
              <DiagnosticPanel
                diagnostic={result.diagnostic}
                totalChannelsInHar={result.channelsInPaste}
              />
            </div>
          ) : null}
          {result.promoted > 0 ? (
            <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              Promoted {result.promoted} row{result.promoted === 1 ? '' : 's'}.{' '}
              <a href="/admin/slack" className="font-semibold underline">
                Back to mappings →
              </a>
            </p>
          ) : null}
        </Card>
      ) : null}

      {result && !result.parseError && result.suggestions.length > 0 ? (
        <Card title={`Near-match suggestions (${visibleSuggestions.length} pending review)`}>
          <p className="mb-3 text-xs text-gray-600">
            Candidates whose <code>cust-{'{slug}'}</code> didn't exactly match
            anything in your HAR, but a close variant did. Common causes:
            slugifier disagreed on a suffix (Inc/Corp/LLC), or the actual
            channel uses a slightly different name. Review one at a time.
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
                        title={
                          s.suggestion.isArchived
                            ? 'Cannot accept an archived channel'
                            : 'Accept this match — writes a manual override pointing this account at the suggested channel'
                        }
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
              {visibleSuggestions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-xs text-gray-500">
                    All suggestions reviewed.{' '}
                    <a href="/admin/slack" className="text-blue-700 underline">
                      Back to mappings →
                    </a>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {acceptedAccounts.size > 0 ? (
            <p className="mt-3 text-xs text-emerald-800">
              ✓ {acceptedAccounts.size} accepted
            </p>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

// Side-by-side view of what the HAR contained vs. what we tried to
// match, with a plain-English read of the most likely cause when
// promoted=0. Surfaces the actual data so the operator can spot the
// disagreement (wrong prefix? wrong separator? convention diverges?)
// rather than guess.
function DiagnosticPanel({
  diagnostic,
  totalChannelsInHar,
}: {
  diagnostic: PromoteResult['diagnostic'];
  totalChannelsInHar: number;
}): JSX.Element {
  const { sampleCustChannels, custChannelCount, sampleCandidatesWeTried } = diagnostic;

  // Diagnose the most likely cause.
  let likelyCause: JSX.Element;
  if (totalChannelsInHar < 20) {
    likelyCause = (
      <>
        <strong>Likely cause</strong>: HAR captured very few channels
        ({totalChannelsInHar} total). Slack's boot only ships the channels
        you've recently visited, not the full directory. Re-record while
        actively using ⌘K and typing several cust-* prefixes — that fires
        the edge-API channel search endpoint, which returns matches per
        keystroke and adds them to the HAR.
      </>
    );
  } else if (custChannelCount === 0) {
    likelyCause = (
      <>
        <strong>Likely cause</strong>: the HAR contains {totalChannelsInHar}{' '}
        channels but <em>none</em> of them start with "cust". Either the
        cust-* naming convention isn't used at Zuora, or the channels you
        care about live in workspaces other than the one you recorded from
        (Enterprise Grid has per-workspace channel scoping). Check the
        sample below to see what naming patterns ARE present.
      </>
    );
  } else if (custChannelCount > 0 && sampleCandidatesWeTried.length > 0) {
    // We have cust channels in HAR + we have candidates we tried, but no
    // exact match. Most informative case — show them side-by-side.
    likelyCause = (
      <>
        <strong>Likely cause</strong>: the HAR has {custChannelCount} cust-*
        channels but none match our derived <code>cust-{'{slug}'}</code> names
        exactly. Compare the two columns below — the disagreement is
        usually one of: (a) separator (dash vs. underscore), (b) suffix
        stripping (Inc/Corp/LLC handled differently), or (c) Zuora uses a
        different prefix than <code>cust-</code>.
      </>
    );
  } else {
    likelyCause = (
      <>
        <strong>Likely cause</strong>: no current{' '}
        <code>heuristic_candidate</code> rows have a derived channel name to
        match against. Either all candidates already resolved, or the
        derivation step is failing — check{' '}
        <a href="/admin/slack" className="underline">
          the mappings page
        </a>{' '}
        to confirm there are still candidates pending.
      </>
    );
  }

  return (
    <>
      <p>{likelyCause}</p>
      <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
        <div>
          <div className="mb-1 font-semibold">
            Sample cust-* channels found in HAR ({custChannelCount} total)
          </div>
          {sampleCustChannels.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded border border-amber-200 bg-white p-2 font-mono text-[11px] text-gray-700">
              {sampleCustChannels.map((n) => (
                <div key={n}>#{n}</div>
              ))}
              {custChannelCount > sampleCustChannels.length ? (
                <div className="pt-1 text-amber-700">
                  …{custChannelCount - sampleCustChannels.length} more
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded border border-amber-200 bg-white p-2 italic text-gray-500">
              none
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 font-semibold">
            Sample names we tried to match (first 20 of{' '}
            {sampleCandidatesWeTried.length === 20 ? '20+' : sampleCandidatesWeTried.length})
          </div>
          {sampleCandidatesWeTried.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded border border-amber-200 bg-white p-2 font-mono text-[11px] text-gray-700">
              {sampleCandidatesWeTried.map((n) => (
                <div key={n}>#{n}</div>
              ))}
            </div>
          ) : (
            <div className="rounded border border-amber-200 bg-white p-2 italic text-gray-500">
              no heuristic candidates with derived names
            </div>
          )}
        </div>
      </div>
    </>
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
