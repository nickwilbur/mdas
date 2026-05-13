import type { AdapterProgress, RefreshProgress } from '@mdas/db';
import { updateRefreshProgress } from '@mdas/db';

// ---------------------------------------------------------------------------
// Progress tracking — debounced writes to refresh_runs.progress
// ---------------------------------------------------------------------------

export class ProgressTracker {
  private adapters: Record<string, AdapterProgress> = {};
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly refreshId: string,
    sources: string[],
  ) {
    for (const s of sources) {
      this.adapters[s] = { status: 'pending', current: 0, total: 0 };
    }
  }

  markRunning(source: string, total: number): void {
    this.adapters[source] = { status: 'running', current: 0, total };
    this.dirty = true;
  }

  report(source: string, current: number, total: number, label?: string): void {
    const a = this.adapters[source];
    if (a) {
      a.current = current;
      a.total = total;
      a.status = 'running';
      a.label = label;
      this.dirty = true;
    }
  }

  markDone(source: string, count: number): void {
    this.adapters[source] = { status: 'done', current: count, total: count };
    this.dirty = true;
  }

  markError(source: string): void {
    const a = this.adapters[source];
    if (a) a.status = 'error';
    this.dirty = true;
  }

  /** Start periodic flushing to DB (every 2s). */
  startFlushing(): void {
    this.timer = setInterval(() => void this.flush(), 2_000);
  }

  stopFlushing(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): RefreshProgress {
    const totalWeight = Object.values(this.adapters).reduce(
      (s, a) => s + Math.max(a.total, 1),
      0,
    );
    const doneWeight = Object.values(this.adapters).reduce((s, a) => {
      if (a.status === 'done' || a.status === 'error') return s + Math.max(a.total, 1);
      return s + a.current;
    }, 0);
    const pct = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0;
    return { adapters: { ...this.adapters }, pct };
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await updateRefreshProgress(this.refreshId, this.snapshot());
    } catch {
      // Best-effort — don't crash the refresh over a progress write.
    }
  }
}
