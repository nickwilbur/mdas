import { NextResponse } from 'next/server';
import { generateForecastScript } from '@/lib/forecast-generate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StreamEvent =
  | { type: 'progress'; step: string; label: string; pct: number }
  | { type: 'done'; text: string; asOfDate: string }
  | { type: 'error'; error: string; detail?: string };

/**
 * Generate the plaintext quarterly churn-forecast script.
 *
 * Returns NDJSON (`application/x-ndjson`): progress events while Glean
 * enrichment runs, then a final `done` or `error` line.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    asOfDate?: string;
    plan?: { currentQuarterUSD?: number; nextQuarterUSD?: number };
    clariManagerForecastCsv?: string;
  };
  const asOfDate = body.asOfDate ?? new Date().toISOString().slice(0, 10);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: StreamEvent): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        try {
          const result = await generateForecastScript(
            req,
            {
              asOfDate,
              plan: body.plan,
              clariManagerForecastCsv: body.clariManagerForecastCsv,
            },
            (update) => {
              emit({
                type: 'progress',
                step: update.step,
                label: update.label,
                pct: update.pct,
              });
            },
          );
          emit({ type: 'done', text: result.text, asOfDate: result.asOfDate });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('forecast.route.failed', err);
          const message = (err as Error)?.message ?? 'Unknown error';
          emit({
            type: 'error',
            error: 'Failed to generate forecast',
            detail: message,
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
    },
  });
}
