import { EventEmitter } from 'node:events';
import { DataPoint } from './interfaces/data-point.interface';

export type DataChangeCallback = (key: string, point: DataPoint) => void;

export interface SeriesQueryOpts {
  from?: number;
  to?: number;
  limit?: number;
}

export interface KeyMemoryUsage {
  key: string;
  /** Number of stored data points */
  points: number;
  /** Estimated memory in bytes (JSON-serialized size of key + series) */
  bytes: number;
  /** Human-readable size string, e.g. "1.23 KB" */
  bytesHuman: string;
}

export interface MemoryUsageReport {
  keys: KeyMemoryUsage[];
  total: {
    /** Number of keys in the store */
    keys: number;
    /** Total number of data points across all keys */
    points: number;
    /** Total estimated bytes */
    bytes: number;
    /** Human-readable total size */
    bytesHuman: string;
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(2)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

/**
 * Estimates memory usage of a key's series as the byte length of its
 * JSON-serialized representation (key string + array of DataPoints).
 * This is deterministic, platform-independent, and meaningful to clients.
 */
function estimateKeyBytes(key: string, series: DataPoint[]): number {
  return (
    Buffer.byteLength(key, 'utf8') +
    Buffer.byteLength(JSON.stringify(series), 'utf8')
  );
}

function buildReport(usages: KeyMemoryUsage[]): MemoryUsageReport {
  const totalBytes = usages.reduce((sum, u) => sum + u.bytes, 0);
  const totalPoints = usages.reduce((sum, u) => sum + u.points, 0);
  return {
    keys: usages,
    total: {
      keys: usages.length,
      points: totalPoints,
      bytes: totalBytes,
      bytesHuman: formatBytes(totalBytes),
    },
  };
}

/**
 * In-memory time-series store.
 * Deduplicates: if the value has not changed, no new point is recorded.
 * FIFO: when maxPoints is reached the oldest point is dropped.
 */
export class DataStore {
  private readonly store = new Map<string, DataPoint[]>();
  private readonly emitter = new EventEmitter();

  constructor(private readonly maxPoints: number = 100_000) {
    this.emitter.setMaxListeners(500);
  }

  /**
   * Record a value for a key.
   * @param key   arbitrary string key
   * @param value numeric value
   * @param timestamp Unix ms (defaults to Date.now())
   */
  record(key: string, value: number, timestamp?: number): void {
    let series = this.store.get(key);
    if (!series) {
      series = [];
      this.store.set(key, series);
    }

    // Deduplication
    const last = series.length > 0 ? series[series.length - 1] : null;
    if (last && last.v === value) return;

    // FIFO trim
    if (series.length >= this.maxPoints) {
      series.shift();
    }

    const point: DataPoint = { t: timestamp ?? Date.now(), v: value };
    series.push(point);

    // Per-key event
    this.emitter.emit(key, point);
    // Global event
    this.emitter.emit('__any__', key, point);
  }

  /**
   * Get time series for a key with optional filtering.
   */
  getSeries(key: string, opts?: SeriesQueryOpts): DataPoint[] {
    let series = this.store.get(key) ?? [];

    if (opts?.from !== undefined) {
      series = series.filter((p) => p.t >= opts.from!);
    }
    if (opts?.to !== undefined) {
      series = series.filter((p) => p.t <= opts.to!);
    }
    if (opts?.limit !== undefined && opts.limit > 0) {
      series = series.slice(-opts.limit);
    }

    return series;
  }

  /** Last recorded point for a key, or null if none. */
  getLastPoint(key: string): DataPoint | null {
    const series = this.store.get(key);
    return series && series.length > 0 ? series[series.length - 1] : null;
  }

  /** All keys that have data. */
  getKeys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Extended key listing with optional point count and memory info.
   * Without flags behaves like getKeys() but returns objects.
   */
  getKeysInfo(opts?: { detail?: boolean; memory?: boolean }): any[] {
    const result: any[] = [];
    for (const [key, series] of this.store) {
      const entry: any = { key };
      if (opts?.detail) {
        entry.points = series.length;
        entry.firstTimestamp = series.length > 0 ? series[0].t : null;
        entry.lastTimestamp = series.length > 0 ? series[series.length - 1].t : null;
      }
      if (opts?.memory) {
        const bytes = estimateKeyBytes(key, series);
        entry.bytes = bytes;
        entry.bytesHuman = formatBytes(bytes);
      }
      result.push(entry);
    }
    return result;
  }

  /** Delete all data for a key. */
  deleteSeries(key: string): void {
    this.store.delete(key);
  }

  /** Clear all data. */
  clear(): void {
    this.store.clear();
  }

  /**
   * Estimated memory usage for a single key.
   * Returns null if the key does not exist.
   */
  getKeyMemoryUsage(key: string): KeyMemoryUsage | null {
    const series = this.store.get(key);
    if (!series) return null;
    const bytes = estimateKeyBytes(key, series);
    return { key, points: series.length, bytes, bytesHuman: formatBytes(bytes) };
  }

  /**
   * Estimated memory usage for a list of keys.
   * Missing keys are silently skipped.
   */
  getMemoryUsageForKeys(keys: string[]): MemoryUsageReport {
    const usages: KeyMemoryUsage[] = [];
    for (const key of keys) {
      const u = this.getKeyMemoryUsage(key);
      if (u) usages.push(u);
    }
    return buildReport(usages);
  }

  /** Estimated memory usage for all keys in the store. */
  getTotalMemoryUsage(): MemoryUsageReport {
    const usages: KeyMemoryUsage[] = [];
    for (const [key, series] of this.store) {
      const bytes = estimateKeyBytes(key, series);
      usages.push({ key, points: series.length, bytes, bytesHuman: formatBytes(bytes) });
    }
    return buildReport(usages);
  }

  /**
   * Subscribe to changes of a specific key.
   * Returns an unsubscribe function.
   */
  onChange(key: string, cb: (point: DataPoint) => void): () => void {
    this.emitter.on(key, cb);
    return () => {
      this.emitter.off(key, cb);
    };
  }

  /**
   * Subscribe to changes of multiple keys.
   * The callback receives (key, point).
   * Returns an unsubscribe function.
   */
  onChangeMulti(keys: string[], cb: DataChangeCallback): () => void {
    const wrappers = new Map<string, (point: DataPoint) => void>();
    for (const key of keys) {
      const wrapper = (point: DataPoint) => cb(key, point);
      wrappers.set(key, wrapper);
      this.emitter.on(key, wrapper);
    }
    return () => {
      for (const [key, wrapper] of wrappers) {
        this.emitter.off(key, wrapper);
      }
    };
  }

  /**
   * Subscribe to all changes.
   * The callback receives (key, point).
   * Returns an unsubscribe function.
   */
  onAnyChange(cb: DataChangeCallback): () => void {
    this.emitter.on('__any__', cb);
    return () => {
      this.emitter.off('__any__', cb);
    };
  }
}
