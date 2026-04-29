'use client';

// GleanChatPanel — wraps /api/glean/chat with a simple message log + composer.
//
// Buffered (non-streaming) for now — Glean's chat replies are short
// enough that a JSON round-trip is fine. The state is local to the
// component (no persistence): close the panel and the conversation
// is lost. We can add per-account chat persistence later if managers
// ask for it; the API already accepts an optional chatId.
import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, ExternalLink, Sparkles } from 'lucide-react';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  citations?: { title?: string; url?: string; datasource?: string }[];
}

export interface GleanChatPanelProps {
  /** Seed system-style context (rendered as the first user turn label). */
  contextLabel?: string;
  /** Pre-populated initial message in the composer (e.g. "Summarize Acme's last QBR"). */
  initialPrompt?: string;
}

export function GleanChatPanel({
  contextLabel,
  initialPrompt = '',
}: GleanChatPanelProps): JSX.Element {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [turns, loading]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || loading) return;
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', text }];
    setTurns(nextTurns);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/glean/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: nextTurns.map((t) => ({ role: t.role, text: t.text })),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? `Chat failed (${r.status})`);
        return;
      }
      setTurns([
        ...nextTurns,
        {
          role: 'assistant',
          text: data.reply ?? '',
          citations: data.citations ?? [],
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[70vh] flex-col rounded-lg border border-gray-200 bg-white">
      {contextLabel && (
        <div className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-2 text-xs text-gray-600">
          <Sparkles className="h-3.5 w-3.5 text-violet-600" aria-hidden />
          Context: <span className="font-medium text-gray-900">{contextLabel}</span>
        </div>
      )}
      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && !loading && (
          <p className="px-2 py-6 text-center text-sm text-gray-500">
            Ask Glean anything — it sees the same docs you can in the Glean UI.
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={
              t.role === 'user'
                ? 'ml-auto max-w-[80%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white'
                : 'mr-auto max-w-[90%] space-y-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900'
            }
          >
            <div className="whitespace-pre-wrap">{t.text}</div>
            {t.role === 'assistant' && t.citations && t.citations.length > 0 && (
              <ul className="mt-1 space-y-0.5 border-t border-gray-200 pt-1.5">
                {t.citations.map((c, j) => (
                  <li key={j} className="text-[11px]">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                    >
                      <span>[{j + 1}]</span>
                      <span className="truncate">{c.title ?? c.url}</span>
                      <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                    </a>
                    {c.datasource && (
                      <span className="ml-1 text-gray-500">· {c.datasource}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {loading && (
          <div className="mr-auto inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Thinking…
          </div>
        )}
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 border-t border-gray-200 p-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Ask Glean…  (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" aria-hidden /> Send
        </button>
      </form>
    </div>
  );
}
