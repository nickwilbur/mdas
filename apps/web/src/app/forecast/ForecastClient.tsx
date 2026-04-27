'use client';
import { useState } from 'react';

export function ForecastClient() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);
  const [audience, setAudience] = useState('My Leader + Sales Leadership + CS Leadership');
  const [markdown, setMarkdown] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const r = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asOfDate, audience }),
      });
      const j = (await r.json()) as { markdown: string };
      setMarkdown(j.markdown);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    void navigator.clipboard.writeText(markdown);
  }

  function download() {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expand-3-forecast-${asOfDate}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
        <button onClick={copy} disabled={!markdown} className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
          Copy Markdown
        </button>
        <button onClick={download} disabled={!markdown} className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
          Download .md
        </button>
      </div>
      <pre className="min-h-[400px] whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-mono text-sm">
        {markdown || '— click Generate Update to render —'}
      </pre>
    </div>
  );
}
