import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataStore,
  DataChangeCallback,
  SeriesQueryOpts,
  KeyMemoryUsage,
  MemoryUsageReport,
  StoreSnapshotData,
} from './data-store';
import { DataPoint } from './interfaces/data-point.interface';

@Injectable()
export class StoreService {
  private readonly dataStore: DataStore;

  constructor(private readonly configService: ConfigService) {
    const maxPoints = this.configService.get<number>('MAX_POINTS_PER_KEY', 100_000);
    this.dataStore = new DataStore(maxPoints);
  }

  write(key: string, value: number, timestamp?: number): void {
    this.dataStore.record(key, value, timestamp);
  }

  writeBatch(points: Array<{ key: string; value: number; timestamp?: number }>): void {
    for (const p of points) {
      this.dataStore.record(p.key, p.value, p.timestamp);
    }
  }

  getSeries(key: string, opts?: SeriesQueryOpts): DataPoint[] {
    return this.dataStore.getSeries(key, opts);
  }

  getLastPoint(key: string): DataPoint | null {
    return this.dataStore.getLastPoint(key);
  }

  getKeys(): string[] {
    return this.dataStore.getKeys();
  }

  getKeysInfo(opts?: { detail?: boolean; memory?: boolean }): any[] {
    return this.dataStore.getKeysInfo(opts);
  }

  exportSnapshot(): StoreSnapshotData {
    return this.dataStore.serialize();
  }

  restoreSnapshot(data: unknown, opts?: { limitPerKey?: number }): void {
    this.dataStore.restore(data, opts);
  }

  deleteSeries(key: string): void {
    this.dataStore.deleteSeries(key);
  }

  clear(): void {
    this.dataStore.clear();
  }

  onChange(key: string, cb: (point: DataPoint) => void): () => void {
    return this.dataStore.onChange(key, cb);
  }

  onChangeMulti(keys: string[], cb: DataChangeCallback): () => void {
    return this.dataStore.onChangeMulti(keys, cb);
  }

  onAnyChange(cb: DataChangeCallback): () => void {
    return this.dataStore.onAnyChange(cb);
  }

  getSnapshot(): Record<string, DataPoint | null> {
    return this.dataStore.getKeys().reduce<Record<string, DataPoint | null>>((acc, key) => {
      acc[key] = this.dataStore.getLastPoint(key);
      return acc;
    }, {});
  }

  getRecentSnapshot(opts?: SeriesQueryOpts): Record<string, { points: DataPoint[]; count: number }> {
    const result: Record<string, { points: DataPoint[]; count: number }> = {};
    const queryOpts: SeriesQueryOpts = {
      from: opts?.from,
      to: opts?.to,
      limit: opts?.limit ?? 100,
    };
    for (const key of this.dataStore.getKeys()) {
      const points = this.dataStore.getSeries(key, queryOpts);
      result[key] = { points, count: points.length };
    }
    return result;
  }

  getKeyMemoryUsage(key: string): KeyMemoryUsage | null {
    return this.dataStore.getKeyMemoryUsage(key);
  }

  getMemoryUsageForKeys(keys: string[]): MemoryUsageReport {
    return this.dataStore.getMemoryUsageForKeys(keys);
  }

  getTotalMemoryUsage(): MemoryUsageReport {
    return this.dataStore.getTotalMemoryUsage();
  }
}

