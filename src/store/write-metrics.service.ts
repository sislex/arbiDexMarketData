import { Injectable } from '@nestjs/common';
import { WriteRecordResult } from './data-store';

export type WriteMetricsSource = 'rest' | 'ws';

const WINDOW_TO_MINUTES = {
  '1m': 1,
  '10m': 10,
  '1h': 60,
  '12h': 720,
  '24h': 1440,
} as const;

export type MetricsWindow = keyof typeof WINDOW_TO_MINUTES;

export interface MinutePoint {
  minuteStart: number;
  incomingWrites: number;
  acceptedWrites: number;
  invalidPayloadCount: number;
}

export interface ScopeMetrics {
  incomingWrites: number;
  acceptedWrites: number;
  invalidPayloadCount: number;
  wsVsRestShare: {
    incoming: { ws: number; rest: number; wsShare: number; restShare: number };
    accepted: { ws: number; rest: number; wsShare: number; restShare: number };
  };
  peakMinute: { count: number };
}

interface Counter {
  incomingWrites: number;
  acceptedWrites: number;
  invalidPayloadCount: number;
  wsIncoming: number;
  restIncoming: number;
  wsAccepted: number;
  restAccepted: number;
}

interface KeyMetricsResponse {
  key: string;
  isActive: boolean;
  windows: Record<MetricsWindow, ScopeMetrics>;
  series: {
    rangeMinutes: number;
    stepMinutes: 1;
    points: MinutePoint[];
  };
  sinceStart: ScopeMetrics;
}

interface Bucket extends Counter {}

const ALL_WINDOWS: MetricsWindow[] = ['1m', '10m', '1h', '12h', '24h'];
const MAX_SERIES_MINUTES = 1440;

function emptyCounter(): Counter {
  return {
    incomingWrites: 0,
    acceptedWrites: 0,
    invalidPayloadCount: 0,
    wsIncoming: 0,
    restIncoming: 0,
    wsAccepted: 0,
    restAccepted: 0,
  };
}

function toScopeMetrics(counter: Counter, peakCount: number): ScopeMetrics {
  const incomingTotal = counter.incomingWrites || 1;
  const acceptedTotal = counter.acceptedWrites || 1;
  return {
    incomingWrites: counter.incomingWrites,
    acceptedWrites: counter.acceptedWrites,
    invalidPayloadCount: counter.invalidPayloadCount,
    wsVsRestShare: {
      incoming: {
        ws: counter.wsIncoming,
        rest: counter.restIncoming,
        wsShare: Number((counter.wsIncoming / incomingTotal).toFixed(4)),
        restShare: Number((counter.restIncoming / incomingTotal).toFixed(4)),
      },
      accepted: {
        ws: counter.wsAccepted,
        rest: counter.restAccepted,
        wsShare: Number((counter.wsAccepted / acceptedTotal).toFixed(4)),
        restShare: Number((counter.restAccepted / acceptedTotal).toFixed(4)),
      },
    },
    peakMinute: { count: peakCount },
  };
}

@Injectable()
export class WriteMetricsService {
  private readonly buckets = new Map<number, Bucket>();
  private readonly keyBuckets = new Map<string, Map<number, Bucket>>();
  private readonly sinceStart = emptyCounter();
  private readonly sinceStartByKey = new Map<string, Counter>();

  recordMalformed(source: WriteMetricsSource): void {
    this.recordCounter(source, 'invalid');
  }

  recordAttempt(source: WriteMetricsSource, key: string, result: WriteRecordResult): void {
    this.recordCounter(source, result, key);
  }

  getServiceMetrics(opts?: {
    windows?: MetricsWindow[];
    seriesMinutes?: number;
    topLimit?: number;
  }): any {
    const windows = this.normalizeWindows(opts?.windows);
    const longest = this.getLongestWindowMinutes(windows);
    const nowMinute = this.getMinuteBucket(Date.now());
    this.cleanup(nowMinute);

    const windowsReport = this.buildWindowsReport(windows, (minutes) => this.sumGlobal(minutes, nowMinute), (minutes) => this.peakGlobal(minutes, nowMinute));
    const seriesMinutes = this.normalizeSeriesMinutes(opts?.seriesMinutes);

    return {
      scope: 'service',
      windows: windowsReport,
      activeKeys: this.getActiveKeys(longest).length,
      series: {
        rangeMinutes: seriesMinutes,
        stepMinutes: 1,
        points: this.buildSeries(seriesMinutes, nowMinute, (minute) => this.buckets.get(minute)),
      },
      topKeys: this.getTopKeys(this.normalizeTopLimit(opts?.topLimit), longest, nowMinute),
      sinceStart: toScopeMetrics(this.sinceStart, this.peakGlobalSinceStart()),
    };
  }

  getKeyMetrics(key: string, opts?: { windows?: MetricsWindow[]; seriesMinutes?: number }): KeyMetricsResponse {
    const windows = this.normalizeWindows(opts?.windows);
    const longest = this.getLongestWindowMinutes(windows);
    const nowMinute = this.getMinuteBucket(Date.now());
    this.cleanup(nowMinute);

    const windowsReport = this.buildWindowsReport(
      windows,
      (minutes) => this.sumForKey(key, minutes, nowMinute),
      (minutes) => this.peakForKey(key, minutes, nowMinute),
    );

    const seriesMinutes = this.normalizeSeriesMinutes(opts?.seriesMinutes);
    const keyMap = this.keyBuckets.get(key);
    const sinceStart = this.sinceStartByKey.get(key) ?? emptyCounter();

    return {
      key,
      isActive: this.sumForKey(key, longest, nowMinute).acceptedWrites > 0,
      windows: windowsReport,
      series: {
        rangeMinutes: seriesMinutes,
        stepMinutes: 1,
        points: this.buildSeries(seriesMinutes, nowMinute, (minute) => keyMap?.get(minute)),
      },
      sinceStart: toScopeMetrics(sinceStart, this.peakForKeySinceStart(key)),
    };
  }

  getKeysMetrics(keys: string[], opts?: { windows?: MetricsWindow[]; seriesMinutes?: number }): any {
    const uniqKeys = Array.from(new Set(keys.filter((k) => typeof k === 'string' && k.length > 0)));
    const windows = this.normalizeWindows(opts?.windows);
    const longest = this.getLongestWindowMinutes(windows);
    const nowMinute = this.getMinuteBucket(Date.now());
    this.cleanup(nowMinute);

    const windowsReport = this.buildWindowsReport(
      windows,
      (minutes) => this.sumForKeys(uniqKeys, minutes, nowMinute),
      (minutes) => this.peakForKeys(uniqKeys, minutes, nowMinute),
    );

    const perKey: Record<string, KeyMetricsResponse> = {};
    for (const key of uniqKeys) {
      perKey[key] = this.getKeyMetrics(key, { windows, seriesMinutes: opts?.seriesMinutes });
    }

    const sinceStartCounter = uniqKeys.reduce((acc, key) => this.mergeCounters(acc, this.sinceStartByKey.get(key)), emptyCounter());
    const seriesMinutes = this.normalizeSeriesMinutes(opts?.seriesMinutes);

    return {
      scope: 'keys',
      keys: uniqKeys,
      windows: windowsReport,
      activeKeys: this.getActiveKeys(longest, uniqKeys).length,
      series: {
        rangeMinutes: seriesMinutes,
        stepMinutes: 1,
        points: this.buildSeries(seriesMinutes, nowMinute, (minute) => this.sumForKeysMinute(uniqKeys, minute)),
      },
      perKey,
      sinceStart: toScopeMetrics(sinceStartCounter, this.peakForKeysSinceStart(uniqKeys)),
    };
  }

  private recordCounter(source: WriteMetricsSource, result: WriteRecordResult | 'invalid', key?: string): void {
    const nowMinute = this.getMinuteBucket(Date.now());
    this.cleanup(nowMinute);

    const globalBucket = this.getOrCreateBucket(this.buckets, nowMinute);
    this.incrementCounters(globalBucket, source, result);
    this.incrementCounters(this.sinceStart, source, result);

    if (!key) return;

    const keyMap = this.getOrCreateKeyMap(key);
    const keyBucket = this.getOrCreateBucket(keyMap, nowMinute);
    this.incrementCounters(keyBucket, source, result);

    const sinceStartKey = this.sinceStartByKey.get(key) ?? emptyCounter();
    this.incrementCounters(sinceStartKey, source, result);
    this.sinceStartByKey.set(key, sinceStartKey);
  }

  private incrementCounters(counter: Counter, source: WriteMetricsSource, result: WriteRecordResult | 'invalid'): void {
    counter.incomingWrites += 1;
    if (source === 'ws') counter.wsIncoming += 1;
    else counter.restIncoming += 1;

    if (result === 'accepted') {
      counter.acceptedWrites += 1;
      if (source === 'ws') counter.wsAccepted += 1;
      else counter.restAccepted += 1;
    }

    if (result === 'invalid') {
      counter.invalidPayloadCount += 1;
    }
  }

  private buildWindowsReport(
    windows: MetricsWindow[],
    sumFn: (minutes: number) => Counter,
    peakFn: (minutes: number) => number,
  ): Record<MetricsWindow, ScopeMetrics> {
    const result = {} as Record<MetricsWindow, ScopeMetrics>;
    for (const windowName of windows) {
      const minutes = WINDOW_TO_MINUTES[windowName];
      const sum = sumFn(minutes);
      const peak = peakFn(minutes);
      result[windowName] = toScopeMetrics(sum, peak);
    }
    return result;
  }

  private buildSeries(seriesMinutes: number, nowMinute: number, getter: (minute: number) => Counter | undefined): MinutePoint[] {
    const points: MinutePoint[] = [];
    for (let i = seriesMinutes - 1; i >= 0; i -= 1) {
      const minute = nowMinute - i;
      const bucket = getter(minute);
      points.push({
        minuteStart: minute * 60_000,
        incomingWrites: bucket?.incomingWrites ?? 0,
        acceptedWrites: bucket?.acceptedWrites ?? 0,
        invalidPayloadCount: bucket?.invalidPayloadCount ?? 0,
      });
    }
    return points;
  }

  private sumGlobal(minutes: number, nowMinute: number): Counter {
    const counter = emptyCounter();
    for (let i = 0; i < minutes; i += 1) {
      this.mergeCounters(counter, this.buckets.get(nowMinute - i));
    }
    return counter;
  }

  private sumForKey(key: string, minutes: number, nowMinute: number): Counter {
    const counter = emptyCounter();
    const buckets = this.keyBuckets.get(key);
    if (!buckets) return counter;
    for (let i = 0; i < minutes; i += 1) {
      this.mergeCounters(counter, buckets.get(nowMinute - i));
    }
    return counter;
  }

  private sumForKeys(keys: string[], minutes: number, nowMinute: number): Counter {
    const counter = emptyCounter();
    for (const key of keys) {
      this.mergeCounters(counter, this.sumForKey(key, minutes, nowMinute));
    }
    return counter;
  }

  private sumForKeysMinute(keys: string[], minute: number): Counter {
    const counter = emptyCounter();
    for (const key of keys) {
      this.mergeCounters(counter, this.keyBuckets.get(key)?.get(minute));
    }
    return counter;
  }

  private peakGlobal(minutes: number, nowMinute: number): number {
    let max = 0;
    for (let i = 0; i < minutes; i += 1) {
      const value = this.buckets.get(nowMinute - i)?.incomingWrites ?? 0;
      if (value > max) max = value;
    }
    return max;
  }

  private peakForKey(key: string, minutes: number, nowMinute: number): number {
    let max = 0;
    const buckets = this.keyBuckets.get(key);
    if (!buckets) return 0;
    for (let i = 0; i < minutes; i += 1) {
      const value = buckets.get(nowMinute - i)?.incomingWrites ?? 0;
      if (value > max) max = value;
    }
    return max;
  }

  private peakForKeys(keys: string[], minutes: number, nowMinute: number): number {
    let max = 0;
    for (let i = 0; i < minutes; i += 1) {
      const minute = nowMinute - i;
      let total = 0;
      for (const key of keys) {
        total += this.keyBuckets.get(key)?.get(minute)?.incomingWrites ?? 0;
      }
      if (total > max) max = total;
    }
    return max;
  }

  private getTopKeys(limit: number, minutes: number, nowMinute: number): Array<{ key: string; incomingWrites: number; acceptedWrites: number }> {
    const rows: Array<{ key: string; incomingWrites: number; acceptedWrites: number }> = [];
    for (const key of this.keyBuckets.keys()) {
      const metrics = this.sumForKey(key, minutes, nowMinute);
      if (metrics.incomingWrites === 0) continue;
      rows.push({
        key,
        incomingWrites: metrics.incomingWrites,
        acceptedWrites: metrics.acceptedWrites,
      });
    }
    rows.sort((a, b) => b.acceptedWrites - a.acceptedWrites || b.incomingWrites - a.incomingWrites || a.key.localeCompare(b.key));
    return rows.slice(0, limit);
  }

  private getActiveKeys(minutes: number, restrictTo?: string[]): string[] {
    const nowMinute = this.getMinuteBucket(Date.now());
    const keys = restrictTo ?? Array.from(this.keyBuckets.keys());
    const result: string[] = [];
    for (const key of keys) {
      const metrics = this.sumForKey(key, minutes, nowMinute);
      if (metrics.acceptedWrites > 0) result.push(key);
    }
    return result;
  }

  private peakGlobalSinceStart(): number {
    let max = 0;
    for (const bucket of this.buckets.values()) {
      if (bucket.incomingWrites > max) max = bucket.incomingWrites;
    }
    return max;
  }

  private peakForKeySinceStart(key: string): number {
    let max = 0;
    const buckets = this.keyBuckets.get(key);
    if (!buckets) return 0;
    for (const bucket of buckets.values()) {
      if (bucket.incomingWrites > max) max = bucket.incomingWrites;
    }
    return max;
  }

  private peakForKeysSinceStart(keys: string[]): number {
    const perMinute = new Map<number, number>();
    for (const key of keys) {
      const buckets = this.keyBuckets.get(key);
      if (!buckets) continue;
      for (const [minute, bucket] of buckets) {
        perMinute.set(minute, (perMinute.get(minute) ?? 0) + bucket.incomingWrites);
      }
    }
    let max = 0;
    for (const value of perMinute.values()) {
      if (value > max) max = value;
    }
    return max;
  }

  private mergeCounters(target: Counter, source?: Counter): Counter {
    if (!source) return target;
    target.incomingWrites += source.incomingWrites;
    target.acceptedWrites += source.acceptedWrites;
    target.invalidPayloadCount += source.invalidPayloadCount;
    target.wsIncoming += source.wsIncoming;
    target.restIncoming += source.restIncoming;
    target.wsAccepted += source.wsAccepted;
    target.restAccepted += source.restAccepted;
    return target;
  }

  private normalizeWindows(windows?: MetricsWindow[]): MetricsWindow[] {
    if (!windows || windows.length === 0) return ALL_WINDOWS;
    const uniq = Array.from(new Set(windows));
    return uniq.filter((w): w is MetricsWindow => w in WINDOW_TO_MINUTES);
  }

  private normalizeSeriesMinutes(seriesMinutes?: number): number {
    if (!seriesMinutes || seriesMinutes < 1) return 120;
    return Math.min(Math.floor(seriesMinutes), MAX_SERIES_MINUTES);
  }

  private normalizeTopLimit(topLimit?: number): number {
    if (!topLimit || topLimit < 1) return 10;
    return Math.min(Math.floor(topLimit), 100);
  }

  private getLongestWindowMinutes(windows: MetricsWindow[]): number {
    return windows.reduce((max, current) => Math.max(max, WINDOW_TO_MINUTES[current]), 1);
  }

  private getMinuteBucket(timestampMs: number): number {
    return Math.floor(timestampMs / 60_000);
  }

  private getOrCreateKeyMap(key: string): Map<number, Bucket> {
    let map = this.keyBuckets.get(key);
    if (!map) {
      map = new Map<number, Bucket>();
      this.keyBuckets.set(key, map);
    }
    return map;
  }

  private getOrCreateBucket(target: Map<number, Bucket>, minute: number): Bucket {
    let bucket = target.get(minute);
    if (!bucket) {
      bucket = emptyCounter();
      target.set(minute, bucket);
    }
    return bucket;
  }

  private cleanup(nowMinute: number): void {
    const minMinute = nowMinute - (MAX_SERIES_MINUTES - 1);
    for (const minute of this.buckets.keys()) {
      if (minute < minMinute) this.buckets.delete(minute);
    }

    for (const [key, map] of this.keyBuckets) {
      for (const minute of map.keys()) {
        if (minute < minMinute) map.delete(minute);
      }
      if (map.size === 0) this.keyBuckets.delete(key);
    }
  }
}

