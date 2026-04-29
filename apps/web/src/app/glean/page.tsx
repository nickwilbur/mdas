'use client';

// /glean — full-page Glean workspace.
//
// Two tabs:
//   • Search — same component used in the cmd-K overlay, just full-width.
//   • Ask    — Glean Assistant chat (POST /api/glean/chat).
//
// Tab state lives in the URL (?tab=search|ask) so a manager can deep-link
// "open the chat with this prompt" from anywhere — e.g. an action queue
// row could link to /glean?tab=ask&q=Why+is+Acme+at+risk.
import { useEffect, useMemo, useState } from 'react';
import { Search as SearchIcon, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { GleanSearchPanel } from '@/components/GleanSearchPanel';
import { GleanChatPanel } from '@/components/GleanChatPanel';

type Tab = 'search' | 'ask';

function readTabFromUrl(): Tab {
  if (typeof window === 'undefined') return 'search';
  const t = new URLSearchParams(window.location.search).get('tab');
  return t === 'ask' ? 'ask' : 'search';
}

export default function GleanPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('search');
  const initialQuery = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('q') ?? '';
  }, []);

  useEffect(() => {
    setTab(readTabFromUrl());
  }, []);

  function pickTab(t: Tab): void {
    setTab(t);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', t);
      window.history.replaceState(null, '', url.toString());
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Glean</h1>
          <p className="text-sm text-gray-600">
            Search and ask questions across docs, meetings, slack, gmail, and
            connected systems. Results respect the Glean permissions on the
            credential MDAS is using — see{' '}
            <a
              href="/admin/data-quality"
              className="text-blue-700 hover:underline"
            >
              Data Quality
            </a>{' '}
            for source freshness.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200">
        <TabButton active={tab === 'search'} onClick={() => pickTab('search')} icon={<SearchIcon className="h-4 w-4" />}>
          Search
        </TabButton>
        <TabButton active={tab === 'ask'} onClick={() => pickTab('ask')} icon={<MessageSquare className="h-4 w-4" />}>
          Ask Glean
        </TabButton>
      </div>

      {tab === 'search' ? (
        <GleanSearchPanel initialQuery={initialQuery} />
      ) : (
        <GleanChatPanel initialPrompt={initialQuery} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition',
        active
          ? 'border-gray-900 font-medium text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-800',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
