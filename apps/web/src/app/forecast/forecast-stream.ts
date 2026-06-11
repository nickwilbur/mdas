export interface ForecastProgress {
  step: string;
  label: string;
  pct: number;
}

export interface ForecastResponse {
  text: string;
  asOfDate: string;
}

type ForecastStreamEvent =
  | { type: 'progress'; step: string; label: string; pct: number }
  | { type: 'done'; text: string; asOfDate: string }
  | { type: 'error'; error: string; detail?: string };

export function parseForecastStreamLines(lines: string[]): {
  progress: ForecastProgress[];
  done: ForecastResponse | null;
  error: { error: string; detail?: string } | null;
} {
  const progress: ForecastProgress[] = [];
  let done: ForecastResponse | null = null;
  let error: { error: string; detail?: string } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as ForecastStreamEvent;
      if (event.type === 'progress') {
        progress.push({
          step: event.step,
          label: event.label,
          pct: event.pct,
        });
      } else if (event.type === 'done') {
        done = { text: event.text, asOfDate: event.asOfDate };
      } else if (event.type === 'error') {
        error = { error: event.error, detail: event.detail };
      }
    } catch {
      // ignore malformed
    }
  }

  return { progress, done, error };
}

export async function consumeForecastStream(
  response: Response,
  onProgress: (update: ForecastProgress) => void,
): Promise<ForecastResponse | { error: string; detail?: string }> {
  if (!response.body) {
    return {
      error: 'Forecast generation failed',
      detail: `HTTP ${response.status} with empty body`,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastDone: ForecastResponse | null = null;
  let lastError: { error: string; detail?: string } | null = null;

  const handleLine = (line: string): void => {
    const parsed = parseForecastStreamLines([line]);
    for (const p of parsed.progress) onProgress(p);
    if (parsed.done) lastDone = parsed.done;
    if (parsed.error) lastError = parsed.error;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx >= 0) {
      handleLine(buffer.slice(0, newlineIdx));
      buffer = buffer.slice(newlineIdx + 1);
      newlineIdx = buffer.indexOf('\n');
    }
  }

  if (buffer.trim()) handleLine(buffer);

  if (lastError) return lastError;
  if (lastDone) return lastDone;
  if (!response.ok) {
    return {
      error: 'Forecast generation failed',
      detail: `HTTP ${response.status}`,
    };
  }
  return {
    error: 'Forecast generation failed',
    detail: 'No result returned from server',
  };
}
