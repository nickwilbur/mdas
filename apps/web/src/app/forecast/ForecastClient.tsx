'use client';

// Quarterly Churn Forecast generator UI.
//
// Output is a plaintext script the CSE manager pastes into Slack /
// email — no markdown, no links, no rich formatting. The manager fills
// in the optional Plan dollar amounts (leadership-set targets) before
// generating so Gap to Plan is computed; otherwise placeholders ship.
import { useState } from 'react';
import {
  currentFiscalQuarter,
  rollingFiscalQuarters,
  type FiscalQuarter,
} from '@/lib/fiscal';

interface ForecastResponse {
  text: string;
  asOfDate: string;
}

// Anchor date for the selected quarter (start of quarter, used by the
// API to bucket opps into Current vs Next). Q1 = Feb, Q2 = May, etc.
function quarterStartIso(fq: FiscalQuarter): string {
  const monthByQ: Record<number, number> = { 1: 1, 2: 4, 3: 7, 4: 10 };
  const month = monthByQ[fq.q];
  if (month === undefined) return new Date().toISOString().slice(0, 10);
  // FY{N} starts Feb of (N-1).
  const year = fq.fy - 1;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

export function ForecastClient() {
  // Show today + the next 4 quarters; manager rarely needs to look back.
  const availableQuarters = rollingFiscalQuarters(0, 4);
  const today = currentFiscalQuarter();
  const [selectedKey, setSelectedKey] = useState<string>(today.key);
  const [planCurrentUSD, setPlanCurrentUSD] = useState<string>('');
  const [planNextUSD, setPlanNextUSD] = useState<string>('');
  const [response, setResponse] = useState<ForecastResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const selectedQuarter =
    availableQuarters.find((q) => q.key === selectedKey) ?? today;

  async function generate() {
    setBusy(true);
    try {
      const asOfDate = quarterStartIso(selectedQuarter);
      const plan: { currentQuarterUSD?: number; nextQuarterUSD?: number } = {};
      const cur = parseUSD(planCurrentUSD);
      const nxt = parseUSD(planNextUSD);
      if (cur != null) plan.currentQuarterUSD = cur;
      if (nxt != null) plan.nextQuarterUSD = nxt;

      const r = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asOfDate, plan }),
      });
      const j = (await r.json()) as ForecastResponse;
      setResponse(j);
    } finally {
      setBusy(false);
    }
  }

  async function copyAll() {
    if (!response?.text) return;
    await navigator.clipboard.writeText(response.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    if (!response?.text) return;
    const blob = new Blob([response.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `churn-forecast-${selectedQuarter.label.replace(/\s+/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const text = response?.text ?? '';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm text-gray-600">
          Generates a plaintext churn-call script covering the selected
          quarter and the following quarter. Paste directly into Slack
          or email — no formatting required. Plan amounts are optional;
          leave blank to ship a fillable placeholder.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <div className="text-xs text-gray-500">Anchor on Quarter</div>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1"
            >
              {availableQuarters.map((fq) => (
                <option key={fq.key} value={fq.key}>
                  {fq.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="text-xs text-gray-500">
              Plan — Current Quarter ($, optional)
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 250000"
              value={planCurrentUSD}
              onChange={(e) => setPlanCurrentUSD(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="text-sm">
            <div className="text-xs text-gray-500">
              Plan — Next Quarter ($, optional)
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 300000"
              value={planNextUSD}
              onChange={(e) => setPlanNextUSD(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <button
            onClick={generate}
            disabled={busy}
            className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Generating…' : 'Generate Script'}
          </button>
          <button
            onClick={copyAll}
            disabled={!text}
            className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 disabled:opacity-50"
          >
            {copied ? 'Copied!' : 'Copy Script'}
          </button>
          <button
            onClick={download}
            disabled={!text}
            className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            Download .txt
          </button>
        </div>
      </div>

      <pre className="min-h-[480px] whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-mono text-sm">
        {text || '— click Generate Script to render —'}
      </pre>
    </div>
  );
}

function parseUSD(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
