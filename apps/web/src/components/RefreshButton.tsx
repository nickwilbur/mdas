'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function refresh() {
    setBusy(true);
    setMsg('Refreshing…');
    try {
      const r = await fetch('/api/refresh', { method: 'POST' });
      if (!r.ok) throw new Error(`refresh failed: ${r.status}`);
      const j = (await r.json()) as { jobId: string };
      // Poll for the new run to land.
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        const s = await fetch(`/api/refresh/${j.jobId}`);
        if (s.ok) {
          const sj = (await s.json()) as { status: string };
          if (sj.status === 'success' || sj.status === 'failed') {
            setMsg(`Refresh ${sj.status}`);
            startTransition(() => router.refresh());
            break;
          }
        }
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={refresh}
        disabled={busy}
        className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white shadow disabled:opacity-50"
      >
        {busy ? 'Refreshing…' : 'Refresh Data'}
      </button>
      {msg ? <span className="text-xs text-gray-600">{msg}</span> : null}
    </div>
  );
}
