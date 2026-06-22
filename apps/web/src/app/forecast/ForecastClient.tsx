'use client';

// Quarterly Churn Forecast generator UI.
//
// Output is a plaintext script the CSE manager pastes into Slack /
// email — no markdown, no links, no rich formatting. Plan targets are
// optional for Gap to Plan; once set they persist per fiscal quarter in
// this browser so the manager is not prompted every run.
import { useEffect, useState } from 'react';
import {
  currentFiscalQuarter,
  fiscalQuarterFilterOptions,
  type FiscalQuarter,
} from '@/lib/fiscal';
import {
  formatStoredPlanForInput,
  loadChurnPlansByQuarter,
  persistChurnPlanForQuarter,
} from '@/lib/forecast-plan-storage';
import {
  consumeForecastStream,
  type ForecastProgress,
  type ForecastResponse,
} from './forecast-stream';

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
  // History through current + 8 forward quarters (same window as dashboard filters).
  const availableQuarters = fiscalQuarterFilterOptions();
  const today = currentFiscalQuarter();
  const [selectedKey, setSelectedKey] = useState<string>(today.key);
  const [planUSD, setPlanUSD] = useState<string>('');
  const [clariManagerForecastCsv, setClariManagerForecastCsv] = useState<string>('');
  const [response, setResponse] = useState<ForecastResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ForecastProgress | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedQuarter =
    availableQuarters.find((q) => q.key === selectedKey) ?? today;

  /** Load saved plan amount for the selected quarter. */
  useEffect(() => {
    const plans = loadChurnPlansByQuarter();
    const cur = plans[selectedKey];
    setPlanUSD(cur !== undefined ? formatStoredPlanForInput(cur) : '');
  }, [selectedKey]);

  function persistPlansFromInputs() {
    persistChurnPlanForQuarter(selectedKey, parseUSD(planUSD));
  }

  async function generate() {
    setBusy(true);
    setProgress({ step: 'start', label: 'Starting…', pct: 0 });
    try {
      const asOfDate = quarterStartIso(selectedQuarter);
      const plan: { currentQuarterUSD?: number } = {};
      const cur = parseUSD(planUSD);
      if (cur != null) plan.currentQuarterUSD = cur;

      const payload: Record<string, unknown> = { asOfDate, plan };
      if (clariManagerForecastCsv.trim()) {
        payload.clariManagerForecastCsv = clariManagerForecastCsv;
      }

      const r = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok && !r.body) {
        setResponse({
          text: `Forecast generation failed (HTTP ${r.status})`,
          asOfDate,
        });
        return;
      }

      const result = await consumeForecastStream(r, setProgress);
      if ('error' in result) {
        setResponse({
          text: `${result.error}${result.detail ? `: ${result.detail}` : ''}`,
          asOfDate,
        });
        return;
      }
      setResponse(result);
      persistPlansFromInputs();
    } finally {
      setBusy(false);
      setProgress(null);
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
          Generates a plaintext churn-call script for the selected fiscal
          quarter. Paste directly into Slack or email — no formatting
          required. Plan amount (negative dollars for churn/downsell
          targets, e.g.{' '}
          <code className="rounded bg-gray-100 px-1">-2164000</code>) is
          saved per fiscal quarter in this browser after you generate or
          leave the plan field, so you only set it once per quarter.
          Paste a Clari manager forecast export CSV so headline Flash /
          Plan / Hedge match Clari&apos;s latest populated week.
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
              Churn/Downsell Plan ($, optional)
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. -2164000"
              value={planUSD}
              onChange={(e) => setPlanUSD(e.target.value)}
              onBlur={persistPlansFromInputs}
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
        <div className="mt-3">
          <div className="text-xs text-gray-500">
            Clari manager forecast export CSV (optional)
          </div>
          <textarea
            value={clariManagerForecastCsv}
            onChange={(e) => setClariManagerForecastCsv(e.target.value)}
            placeholder="Paste the export: User, Email, … Data Value rows"
            rows={4}
            className="mt-0.5 w-full max-w-3xl rounded border border-gray-300 px-2 py-1 font-mono text-xs"
          />
        </div>
      </div>

      {busy && progress ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-900">
              {progress.label}
            </span>
            <span className="text-sm font-bold tabular-nums text-blue-600">
              {progress.pct}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      ) : null}

      <pre className="min-h-[480px] whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-mono text-sm">
        {text}
      </pre>
    </div>
  );
}

function parseUSD(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
