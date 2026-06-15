'use client';

import { useCallback, useEffect, useState } from 'react';

interface ConnectorStatus {
  id: string;
  product: string;
  transport: string;
  role: string;
  adapterEnabled: boolean;
  envConfigured: boolean;
  state: 'ready' | 'misconfigured' | 'disabled' | 'error';
  ok: boolean;
  summary: string;
  details: string[];
  configureHint: string;
}

const STATE_BADGE: Record<ConnectorStatus['state'], string> = {
  ready: 'bg-emerald-100 text-emerald-800',
  misconfigured: 'bg-amber-100 text-amber-900',
  disabled: 'bg-gray-100 text-gray-700',
  error: 'bg-red-100 text-red-800',
};

export function CerebroConnectorsPanel({
  initialConnectors,
}: {
  initialConnectors: ConnectorStatus[];
}): JSX.Element {
  const [connectors, setConnectors] = useState(initialConnectors);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/cerebro/connectors', { cache: 'no-store' });
      const j = (await r.json()) as { connectors: ConnectorStatus[] };
      setConnectors(j.connectors);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600">
          Two products, two connectors. <strong>Cerebro Engage</strong> is the
          direct API (Risk Category + Analysis). <strong>Cerebro</strong> health
          risk booleans are also available via the Glean index when Engage REST
          is not configured.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="shrink-0 rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'Testing…' : 'Re-test connectors'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {connectors.map((c) => (
          <div
            key={c.id}
            className="rounded-lg border border-gray-200 p-4 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-gray-900">{c.product}</div>
                <div className="text-xs text-gray-500">{c.transport}</div>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${STATE_BADGE[c.state]}`}
              >
                {c.state}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-700">{c.role}</p>
            <p className="mt-2 text-xs font-medium text-gray-900">{c.summary}</p>
            {c.details.length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-xs text-gray-600">
                {c.details.slice(0, 5).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
            <dl className="mt-3 grid grid-cols-2 gap-1 text-xs">
              <dt className="text-gray-500">ADAPTER_CEREBRO</dt>
              <dd>{c.adapterEnabled ? 'real' : 'mock/off'}</dd>
              <dt className="text-gray-500">Credentials</dt>
              <dd>{c.envConfigured ? 'configured' : 'missing'}</dd>
            </dl>
            {!c.ok ? (
              <p className="mt-3 rounded bg-gray-50 p-2 text-xs text-gray-700">
                {c.configureHint}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
