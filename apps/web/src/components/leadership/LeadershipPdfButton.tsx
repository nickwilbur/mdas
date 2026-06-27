'use client';

import { useCallback, useState } from 'react';
import { exportLeadershipBriefPdf } from '@/lib/leadership/export-pdf';
import { toExecDashboardData } from '@/lib/leadership/exec-filter';
import { parseLeadershipReport } from '@/lib/leadership/parse-report';

export function LeadershipPdfButton({
  markdown,
  filename,
}: {
  markdown: string;
  filename?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = toExecDashboardData(parseLeadershipReport(markdown));
      const name = (filename ?? 'expand3-exec-brief').replace(/\.pdf$/, '');
      await exportLeadershipBriefPdf(data, `${name}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF export failed');
    } finally {
      setBusy(false);
    }
  }, [markdown, filename]);

  return (
    <div className="flex flex-col items-end gap-1 print:hidden">
      <button
        type="button"
        onClick={() => void onExport()}
        disabled={busy}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
      >
        {busy ? 'Building PDF…' : 'Download PDF'}
      </button>
      {error ? <p className="max-w-xs text-right text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

/** Browser-print fallback — landscape letter via globals.css @page. */
export function LeadershipPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 print:hidden"
    >
      Print…
    </button>
  );
}
