// POST /api/glean/chat
// Body: { messages: { role: 'user' | 'assistant'; text: string }[]; chatId?: string }
// Returns: { reply: string; citations: GleanChatCitation[]; chatId? }
//
// Buffered (non-streaming) for the MVP: assistant replies are short
// enough that a JSON round-trip is fine and the client stays simple.
// When we want token-by-token rendering we can switch this to an
// `Response` with a ReadableStream and forward Glean's SSE.
import { NextResponse } from 'next/server';
import type { GleanChatRequestMessage } from '@mdas/adapter-shared/glean';
import { gleanForRequest, withGleanErrors } from '@/lib/glean-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatBody {
  messages: { role: 'user' | 'assistant'; text: string }[];
  chatId?: string;
}

export async function POST(req: Request): Promise<Response> {
  const out = await withGleanErrors(async () => {
    const body = (await req.json()) as Partial<ChatBody>;
    const incoming = body.messages ?? [];
    if (incoming.length === 0) {
      return NextResponse.json(
        { error: 'messages is required', code: 'bad-request' },
        { status: 400 },
      );
    }

    const messages: GleanChatRequestMessage[] = incoming.map((m) => ({
      author: m.role === 'assistant' ? 'GLEAN_AI' : 'USER',
      fragments: [{ text: m.text }],
    }));

    const { client } = await gleanForRequest(req);
    const reply = await client.chat({
      messages,
      chatId: body.chatId,
      stream: false,
    });
    return NextResponse.json({
      reply: reply.text,
      citations: reply.citations,
    });
  });
  return out instanceof Response ? out : out;
}
