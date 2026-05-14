type PerfEntry = {
  label: string;
  startTime: number;
  duration?: number;
  count: number;
  totalMs: number;
  maxMs: number;
  minMs: number;
};

const entries = new Map<string, PerfEntry>();
const activeMarks = new Map<string, number>();
let enabled = false;
const frameLabels = new Map<string, number>();

function isDevRuntime(): boolean {
  return /localhost|127\.0\.0\.1/.test(window.location.hostname);
}

function ensureEntry(label: string): PerfEntry {
  let entry = entries.get(label);
  if (!entry) {
    entry = { label, startTime: 0, count: 0, totalMs: 0, maxMs: 0, minMs: Infinity, duration: 0 };
    entries.set(label, entry);
  }
  return entry;
}

export const Perf = {
  enable() {
    enabled = true;
    console.log('[Perf] Performance monitoring enabled');
  },

  disable() {
    enabled = false;
    console.log('[Perf] Performance monitoring disabled');
  },

  isEnabled(): boolean {
    return enabled;
  },

  mark(label: string) {
    if (!enabled) return;
    activeMarks.set(label, performance.now());
  },

  end(label: string): number | undefined {
    if (!enabled) return undefined;
    const start = activeMarks.get(label);
    if (start === undefined) return undefined;
    activeMarks.delete(label);
    const duration = performance.now() - start;
    const entry = ensureEntry(label);
    entry.count += 1;
    entry.totalMs += duration;
    entry.duration = duration;
    if (duration > entry.maxMs) entry.maxMs = duration;
    if (duration < entry.minMs) entry.minMs = duration;
    return duration;
  },

  measure<T>(label: string, fn: () => T): T {
    if (!enabled) return fn();
    Perf.mark(label);
    try {
      const result = fn();
      Perf.end(label);
      return result;
    } catch (e) {
      Perf.end(label);
      throw e;
    }
  },

  async measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!enabled) return fn();
    Perf.mark(label);
    try {
      const result = await fn();
      Perf.end(label);
      return result;
    } catch (e) {
      Perf.end(label);
      throw e;
    }
  },

  frameStart(label: string) {
    if (!enabled) return;
    frameLabels.set(label, performance.now());
  },

  frameEnd(label: string): number | undefined {
    if (!enabled) return undefined;
    const start = frameLabels.get(label);
    if (start === undefined) return undefined;
    frameLabels.delete(label);
    const duration = performance.now() - start;
    const entry = ensureEntry(`frame:${label}`);
    entry.count += 1;
    entry.totalMs += duration;
    entry.duration = duration;
    if (duration > entry.maxMs) entry.maxMs = duration;
    if (duration < entry.minMs) entry.minMs = duration;
    return duration;
  },

  report(): PerfEntry[] {
    return [...entries.values()]
      .sort((a, b) => b.totalMs - a.totalMs)
      .map((e) => ({
        ...e,
        minMs: e.minMs === Infinity ? 0 : e.minMs,
      }));
  },

  printReport() {
    if (!enabled) return;
    const data = Perf.report();
    console.groupCollapsed('[Perf] Performance Report');
    console.table(
      data.map((e) => ({
        Label: e.label,
        Count: e.count,
        'Total (ms)': e.totalMs.toFixed(2),
        'Avg (ms)': e.count > 0 ? (e.totalMs / e.count).toFixed(2) : '0',
        'Max (ms)': e.maxMs.toFixed(2),
        'Min (ms)': e.minMs.toFixed(2),
        'Last (ms)': (e.duration || 0).toFixed(2),
      }))
    );
    console.groupEnd();
  },

  clear() {
    entries.clear();
    activeMarks.clear();
    frameLabels.clear();
  },

  autoInit() {
    if (isDevRuntime()) {
      Perf.enable();
      setInterval(() => Perf.printReport(), 10000);
      console.log('[Perf] Auto-initialized for dev runtime. Use Perf.report() or window.__PERF__ to inspect.');
    }
  },
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__PERF__ = Perf;
}
