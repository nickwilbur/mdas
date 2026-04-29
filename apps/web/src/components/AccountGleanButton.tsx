'use client';

// "Search Glean for {accountName}" — small client island used in
// the account drill-in. Dispatches the same `mdas:glean:open`
// event the cmd-K command bar listens for, so the user can stay
// on the page and triage results in the overlay rather than
// context-switching to /glean.
import { Search } from 'lucide-react';
import { openGleanCommandBar } from './GleanCommandBar';

export function AccountGleanButton({
  accountName,
  className,
}: {
  accountName: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => openGleanCommandBar(accountName)}
      className={
        className ??
        'inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50'
      }
      title={`Open Glean and search for "${accountName}"`}
    >
      <Search className="h-3 w-3" aria-hidden />
      Search Glean
    </button>
  );
}
