'use client';

// Per-user persistence for client-side state.
//
// Audit ref: §3 (Phase 3 PR-C5).
//
// Design constraints:
//   1. SSR-safe: localStorage is undefined on the server, so the hook
//      MUST return the provided initial value on the first render and
//      only hydrate from localStorage on the client (after mount).
//   2. No global state, no auth — this is purely a per-browser
//      convenience layer. Cross-device sync is explicitly out of scope.
//   3. Custom serializer support so callers using `Set` / `Map` / Date
//      can round-trip without writing their own JSON.
//   4. Same-tab cross-component sync via the 'storage' event is NOT
//      relied on (browsers fire it for OTHER tabs only). Components
//      that share a key should mount the same hook instance via
//      React context if they need synchrony.
//
// Failure modes:
//   - Quota exceeded → swallow + console.warn. The next read still
//     returns the in-memory value.
//   - JSON parse error → discard the stored value, fall back to initial.
import { useEffect, useState, useCallback } from 'react';

export interface UseLocalStorageOptions<T> {
  /** Default JSON.stringify; override for Set/Map/Date support. */
  serialize?: (v: T) => string;
  /** Default JSON.parse; override to materialize Set/Map/Date. */
  deserialize?: (s: string) => T;
}

export function useLocalStorage<T>(
  key: string,
  initial: T,
  options: UseLocalStorageOptions<T> = {},
): [T, (v: T | ((prev: T) => T)) => void] {
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? (JSON.parse as (s: string) => T);

  // Server / first-render value is always `initial` so the markup is
  // hydration-stable. We then load from localStorage in useEffect.
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        setValue(deserialize(raw));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[useLocalStorage:${key}] failed to read`, err);
    }
    // We intentionally re-read only when `key` changes; deserialize
    // and the initial value are stable references for the lifetime
    // of a hook instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const computed = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, serialize(computed));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[useLocalStorage:${key}] failed to write`, err);
        }
        return computed;
      });
    },
    [key, serialize],
  );

  return [value, set];
}

// ----- Set serializer helpers -----
//
// Used by AccountsTable for the cseFilter set. Serializes as a plain
// JSON array.
export const setSerializer = {
  serialize: <T>(v: Set<T>): string => JSON.stringify(Array.from(v)),
  deserialize: <T>(s: string): Set<T> => new Set(JSON.parse(s) as T[]),
} as const;
