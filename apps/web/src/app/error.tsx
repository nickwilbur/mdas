'use client';

// Next 14 App Router error boundary. Catches any thrown server-component
// or client-component error from a route in this segment. Without this
// file, a thrown read-model query (e.g. Postgres unreachable) renders
// a blank Next.js 500 page with no context.
//
// Audit ref: F-03 in docs/audit/01_findings.md.
//
// Renders a friendly retry UI with the underlying error message and a
// digest (server-side error fingerprint) so an operator can correlate
// to the worker / app logs.
import { useEffect } from 'react';

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps): JSX.Element {
  // Log the error so it lands in the Next.js dev/prod console with
  // enough context to triage. We deliberately do not swallow the
  // digest — server-side errors set it, client-side ones don't.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[mdas:web:error-boundary]', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-red-200 bg-red-50 p-6">
      <h1 className="text-xl font-semibold text-red-900">Something went wrong</h1>
      <p className="text-sm text-red-800">
        The page couldn’t finish loading. This is almost always a transient
        database or upstream issue — try again in a few seconds.
      </p>
      <pre className="overflow-x-auto rounded border border-red-200 bg-white p-3 text-xs text-red-900">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ''}
      </pre>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
        <a
          href="/admin/refresh"
          className="text-sm text-red-700 underline hover:text-red-900"
        >
          See refresh status
        </a>
      </div>
    </div>
  );
}
