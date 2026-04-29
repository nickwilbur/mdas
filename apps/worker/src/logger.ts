// Structured JSON logger for the worker.
//
// Audit ref: F-14.
//
// Why a hand-rolled logger instead of `pino`:
//   - Zero dependencies. The whole worker is currently dep-light, and
//     `pino` plus its transports add ~3MB to the container without
//     covering anything we don't need.
//   - The collector contract is "one JSON object per line on stdout";
//     anything that ships that contract is interchangeable. If we
//     later need pretty-printing or transports we can swap to pino
//     without changing call sites — the `Logger` type stays the same.
//   - Keeping logging deterministic and dependency-free also makes it
//     trivial to assert log shape from a vitest test.
//
// Output schema (stable):
//   { time: string<iso>, level: 'info'|'warn'|'error', msg: string, …meta }
// `meta` is shallow-merged from the optional second argument and the
// child-logger's bound fields. Reserved keys (time/level/msg) cannot
// be overridden by meta; doing so would break log parsers.

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  /** Returns a child logger with the given fields merged into every record. */
  child: (bindings: Record<string, unknown>) => Logger;
}

const RESERVED = new Set(['time', 'level', 'msg']);

function emit(level: LogLevel, msg: string, fields: Record<string, unknown>): void {
  const safeFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!RESERVED.has(k)) safeFields[k] = v;
  }
  const record = {
    time: new Date().toISOString(),
    level,
    msg,
    ...safeFields,
  };
  const line = JSON.stringify(record);
  if (level === 'error') {
    // Send errors to stderr so a basic shell pipeline can split streams.
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

function makeLogger(bindings: Record<string, unknown>): Logger {
  return {
    info: (msg, meta) => emit('info', msg, { ...bindings, ...(meta ?? {}) }),
    warn: (msg, meta) => emit('warn', msg, { ...bindings, ...(meta ?? {}) }),
    error: (msg, meta) => emit('error', msg, { ...bindings, ...(meta ?? {}) }),
    child: (extra) => makeLogger({ ...bindings, ...extra }),
  };
}

/** Root logger. Components should use a child with their own bindings. */
export const log: Logger = makeLogger({ service: 'worker' });
