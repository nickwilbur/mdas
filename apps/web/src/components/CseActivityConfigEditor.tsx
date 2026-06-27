'use client';

import { useMemo, useState } from 'react';
import type { CseActivityConfig } from '@mdas/cse-activity';

function editableConfig(config: CseActivityConfig): Omit<CseActivityConfig, 'teamMembers'> {
  const { teamMembers: _teamMembers, ...rest } = config;
  return rest;
}

export function CseActivityConfigEditor({ initial }: { initial: CseActivityConfig }) {
  const initialJson = useMemo(() => JSON.stringify(editableConfig(initial), null, 2), [initial]);
  const [json, setJson] = useState(initialJson);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const body = JSON.parse(json) as Partial<CseActivityConfig>;
      const res = await fetch('/api/cse-activity/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setMessage('Configuration saved.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Edit Slack channels, timezone, Friday EOD time, and output paths. Team members are not
        configured here — they are inferred from Expand 3 <code className="text-xs">assignedCSE</code>{' '}
        values in MDAS when snapshots run.
      </p>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        className="h-[480px] w-full rounded border border-gray-300 font-mono text-xs"
        spellCheck={false}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save configuration'}
        </button>
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>
    </div>
  );
}
