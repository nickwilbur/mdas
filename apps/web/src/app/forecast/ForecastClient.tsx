'use client';
import { useState } from 'react';

interface DarkAccount {
  accountId: string;
  accountName: string;
  daysSinceLastSignal: number;
  reason: string;
  arr: number;
}

interface ForecastResponse {
  markdown: string;
  clariCsv: string;
  darkAccounts: DarkAccount[];
  asOfDate: string;
}

export function ForecastClient() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);
  const [audience, setAudience] = useState('My Leader + Sales Leadership + CS Leadership');
  const [response, setResponse] = useState<ForecastResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const r = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asOfDate, audience }),
      });
      const j = (await r.json()) as ForecastResponse;
      setResponse(j);
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
  }

  function download(content: string, ext: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expand-3-forecast-${asOfDate}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const markdown = response?.markdown ?? '';
  const clariCsv = response?.clariCsv ?? '';
  const darkAccounts = response?.darkAccounts ?? [];
  const fmtUSD = (n: number) =>
    n === 0 ? '$0' : `$${Math.round(n).toLocaleString('en-US')}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="text-sm">
          <div className="text-xs text-gray-500">As-of date</div>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
        </label>
        <label className="flex-1 text-sm">
          <div className="text-xs text-gray-500">Audience</div>
          <input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" />
        </label>
        <button onClick={generate} disabled={busy} className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Generating…' : 'Generate Update'}
        </button>
        <button onClick={() => copy(markdown)} disabled={!markdown} className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
          Copy Markdown
        </button>
        <button onClick={() => download(markdown, 'md', 'text/markdown')} disabled={!markdown} className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
          Download .md
        </button>
        {/* PR-C3 / §4.7: Clari-paste CSV one-click flow. The Copy
            button is preferred because manager workflow is paste-into-
            Clari; download is the fallback. */}
        <button onClick={() => copy(clariCsv)} disabled={!clariCsv} className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 disabled:opacity-50">
          Copy Clari CSV
        </button>
        <button onClick={() => download(clariCsv, 'csv', 'text/csv')} disabled={!clariCsv} className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
          Download .csv
        </button>
      </div>

      {darkAccounts.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-semibold text-amber-900">
            Dark accounts: {darkAccounts.length} ({fmtUSD(darkAccounts.reduce((s, d) => s + d.arr, 0))} ARR exposed)
          </div>
          <ul className="mt-1 ml-5 list-disc text-amber-800">
            {darkAccounts.slice(0, 5).map((d) => (
              <li key={d.accountId}>
                <a href={`/accounts/${d.accountId}`} className="underline hover:text-amber-900">
                  {d.accountName}
                </a>{' '}
                — {d.reason}, ARR {fmtUSD(d.arr)}
              </li>
            ))}
            {darkAccounts.length > 5 ? (
              <li className="text-amber-700">…and {darkAccounts.length - 5} more (see markdown).</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <pre className="min-h-[400px] whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-mono text-sm">
        {markdown || '— click Generate Update to render —'}
      </pre>
    </div>
  );
}
