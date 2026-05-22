import { DataStore } from '../data-store';

describe('DataStore', () => {
  let store: DataStore;

  beforeEach(() => {
    store = new DataStore(100_000);
  });

  // ── record ──────────────────────────────────────────────────
  describe('record', () => {
    it('should store a data point', () => {
      store.record('key1', 100, 1000);
      expect(store.getSeries('key1')).toEqual([{ t: 1000, v: 100 }]);
    });

    it('should deduplicate: same value is not recorded twice', () => {
      store.record('key1', 100, 1000);
      store.record('key1', 100, 2000);
      expect(store.getSeries('key1')).toHaveLength(1);
    });

    it('should record when value changes', () => {
      store.record('key1', 100, 1000);
      store.record('key1', 200, 2000);
      expect(store.getSeries('key1')).toHaveLength(2);
    });

    it('should enforce FIFO maxPoints limit', () => {
      const smallStore = new DataStore(2);
      smallStore.record('key1', 1, 1000);
      smallStore.record('key1', 2, 2000);
      smallStore.record('key1', 3, 3000);
      const series = smallStore.getSeries('key1');
      expect(series).toHaveLength(2);
      expect(series[0].v).toBe(2);
      expect(series[1].v).toBe(3);
    });

    it('should use Date.now() as default timestamp', () => {
      const before = Date.now();
      store.record('key1', 42);
      const after = Date.now();
      const point = store.getLastPoint('key1');
      expect(point).not.toBeNull();
      expect(point!.t).toBeGreaterThanOrEqual(before);
      expect(point!.t).toBeLessThanOrEqual(after);
    });

    it('should keep only last value for pool keys', () => {
      const key = 'dex:arb|A/B|bidPool';
      store.record(key, '0xpool1');
      store.record(key, '0xpool2');
      expect(store.getSeries(key)).toEqual([{ v: '0xpool2' }]);
    });
  });

  // ── getSeries ────────────────────────────────────────────────
  describe('getSeries', () => {
    beforeEach(() => {
      store.record('key1', 1, 1000);
      store.record('key1', 2, 2000);
      store.record('key1', 3, 3000);
      store.record('key1', 4, 4000);
    });

    it('should return all points without opts', () => {
      expect(store.getSeries('key1')).toHaveLength(4);
    });

    it('should return empty array for unknown key', () => {
      expect(store.getSeries('unknown')).toEqual([]);
    });

    it('should filter by from (inclusive)', () => {
      const series = store.getSeries('key1', { from: 2000 });
      expect(series).toHaveLength(3);
      expect(series[0].v).toBe(2);
    });

    it('should filter by to (inclusive)', () => {
      const series = store.getSeries('key1', { to: 3000 });
      expect(series).toHaveLength(3);
      expect(series[series.length - 1].v).toBe(3);
    });

    it('should return last N points with limit', () => {
      const series = store.getSeries('key1', { limit: 2 });
      expect(series).toHaveLength(2);
      expect(series[0].v).toBe(3);
      expect(series[1].v).toBe(4);
    });

    it('should combine from and limit', () => {
      // from=2000 → points [2000,3000,4000], limit=2 → last 2 = [3000,4000]
      const series = store.getSeries('key1', { from: 2000, limit: 2 });
      expect(series).toHaveLength(2);
      expect(series[0].t).toBe(3000);
      expect(series[1].t).toBe(4000);
    });
  });

  // ── getLastPoint ─────────────────────────────────────────────
  describe('getLastPoint', () => {
    it('should return null for unknown key', () => {
      expect(store.getLastPoint('unknown')).toBeNull();
    });

    it('should return the last recorded point', () => {
      store.record('key1', 10, 1000);
      store.record('key1', 20, 2000);
      expect(store.getLastPoint('key1')).toEqual({ t: 2000, v: 20 });
    });
  });

  // ── getKeys ──────────────────────────────────────────────────
  describe('getKeys', () => {
    it('should return all keys', () => {
      store.record('a', 1);
      store.record('b', 2);
      expect(store.getKeys()).toEqual(expect.arrayContaining(['a', 'b']));
      expect(store.getKeys()).toHaveLength(2);
    });

    it('should return empty array for empty store', () => {
      expect(store.getKeys()).toHaveLength(0);
    });
  });

  // ── deleteSeries ─────────────────────────────────────────────
  describe('deleteSeries', () => {
    it('should remove the key so getSeries returns []', () => {
      store.record('key1', 100);
      store.deleteSeries('key1');
      expect(store.getSeries('key1')).toEqual([]);
      expect(store.getKeys()).not.toContain('key1');
    });
  });

  // ── clear ────────────────────────────────────────────────────
  describe('clear', () => {
    it('should remove all keys', () => {
      store.record('a', 1);
      store.record('b', 2);
      store.clear();
      expect(store.getKeys()).toHaveLength(0);
    });
  });

  // ── onChange ─────────────────────────────────────────────────
  describe('onChange', () => {
    it('should call callback when value changes', () => {
      const cb = jest.fn();
      store.onChange('key1', cb);
      store.record('key1', 42, 1000);
      expect(cb).toHaveBeenCalledWith({ t: 1000, v: 42 });
    });

    it('should NOT call callback on duplicate value', () => {
      const cb = jest.fn();
      store.onChange('key1', cb);
      store.record('key1', 42);
      store.record('key1', 42);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should stop calling callback after unsubscribe', () => {
      const cb = jest.fn();
      const unsub = store.onChange('key1', cb);
      store.record('key1', 1);
      unsub();
      store.record('key1', 2);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  // ── onAnyChange ──────────────────────────────────────────────
  describe('onAnyChange', () => {
    it('should receive key and point for any change', () => {
      const cb = jest.fn();
      store.onAnyChange(cb);
      store.record('a', 1, 1000);
      store.record('b', 2, 2000);
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenNthCalledWith(1, 'a', { t: 1000, v: 1 });
      expect(cb).toHaveBeenNthCalledWith(2, 'b', { t: 2000, v: 2 });
    });

    it('should stop after unsubscribe', () => {
      const cb = jest.fn();
      const unsub = store.onAnyChange(cb);
      store.record('a', 1);
      unsub();
      store.record('a', 2);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  // ── onChangeMulti ─────────────────────────────────────────────
  describe('onChangeMulti', () => {
    it('should fire for subscribed keys', () => {
      const cb = jest.fn();
      store.onChangeMulti(['key1', 'key2'], cb);
      store.record('key1', 10, 1000);
      store.record('key2', 20, 2000);
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenCalledWith('key1', { t: 1000, v: 10 });
      expect(cb).toHaveBeenCalledWith('key2', { t: 2000, v: 20 });
    });

    it('should NOT fire for unsubscribed keys', () => {
      const cb = jest.fn();
      store.onChangeMulti(['key1'], cb);
      store.record('key2', 99);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should stop after unsubscribe', () => {
      const cb = jest.fn();
      const unsub = store.onChangeMulti(['key1'], cb);
      store.record('key1', 1);
      unsub();
      store.record('key1', 2);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  // ── getKeysInfo ─────────────────────────────────────────────
  describe('getKeysInfo', () => {
    beforeEach(() => {
      store.record('a', 1, 1000);
      store.record('a', 2, 2000);
      store.record('b', 10, 3000);
    });

    it('should return objects with key only when no flags', () => {
      const info = store.getKeysInfo();
      expect(info).toHaveLength(2);
      expect(info[0]).toEqual({ key: 'a' });
      expect(info[1]).toEqual({ key: 'b' });
    });

    it('should include points and timestamps when detail=true', () => {
      const info = store.getKeysInfo({ detail: true });
      expect(info[0]).toMatchObject({ key: 'a', points: 2, firstTimestamp: 1000, lastTimestamp: 2000 });
      expect(info[1]).toMatchObject({ key: 'b', points: 1, firstTimestamp: 3000, lastTimestamp: 3000 });
    });

    it('should include bytes when memory=true', () => {
      const info = store.getKeysInfo({ memory: true });
      expect(info[0].bytes).toBeGreaterThan(0);
      expect(info[0].bytesHuman).toMatch(/B|KB|MB/);
      expect(info[0]).not.toHaveProperty('points');
    });

    it('should include both detail and memory when both flags are true', () => {
      const info = store.getKeysInfo({ detail: true, memory: true });
      expect(info[0]).toHaveProperty('points');
      expect(info[0]).toHaveProperty('bytes');
      expect(info[0]).toHaveProperty('bytesHuman');
      expect(info[0]).toHaveProperty('firstTimestamp');
    });

    it('should return empty array for empty store', () => {
      store.clear();
      expect(store.getKeysInfo({ detail: true, memory: true })).toEqual([]);
    });
  });

  // ── serialize / restore ─────────────────────────────────────
  describe('serialize / restore', () => {
    it('should export a JSON-serializable copy of all series', () => {
      store.record('a', 1, 1000);
      store.record('a', 2, 2000);
      store.record('b', 10, 3000);
      store.record('dex:arb|A/B|bidPool', '0xpool');

      expect(store.serialize()).toEqual({
        a: [{ t: 1000, v: 1 }, { t: 2000, v: 2 }],
        b: [{ t: 3000, v: 10 }],
        'dex:arb|A/B|bidPool': { value: '0xpool' },
      });
    });

    it('should restore snapshot without emitting change events', () => {
      const cb = jest.fn();
      store.onAnyChange(cb);

      store.restore({
        a: [{ t: 1000, v: 1 }, { t: 2000, v: 2 }],
      });

      expect(store.getSeries('a')).toEqual([{ t: 1000, v: 1 }, { t: 2000, v: 2 }]);
      expect(cb).not.toHaveBeenCalled();
    });

    it('should keep only latest limitPerKey points on restore', () => {
      store.restore({
        a: [
          { t: 1000, v: 1 },
          { t: 2000, v: 2 },
          { t: 3000, v: 3 },
          { t: 4000, v: 4 },
        ],
      }, { limitPerKey: 2 });

      expect(store.getSeries('a')).toEqual([{ t: 3000, v: 3 }, { t: 4000, v: 4 }]);
    });

    it('should also respect maxPoints while restoring', () => {
      const smallStore = new DataStore(2);
      smallStore.restore({
        a: [
          { t: 1000, v: 1 },
          { t: 2000, v: 2 },
          { t: 3000, v: 3 },
        ],
      }, { limitPerKey: 10 });

      expect(smallStore.getSeries('a')).toEqual([{ t: 2000, v: 2 }, { t: 3000, v: 3 }]);
    });

    it('should skip invalid keys and points while restoring', () => {
      store.restore({
        valid: [{ t: 1000, v: 1 }, { t: 'bad', v: 2 }, null, { t: 3000, v: Number.NaN }],
        'dex:arb|A/B|askPool': { value: '0xpool' },
        'dex:arb|A/B|bidPool': [{ t: 1000, v: 'legacy' }],
        empty: [],
        broken: 'not-array',
      });

      expect(store.getKeys()).toEqual(['valid', 'dex:arb|A/B|askPool']);
      expect(store.getSeries('valid')).toEqual([{ t: 1000, v: 1 }]);
      expect(store.getSeries('dex:arb|A/B|askPool')).toEqual([{ v: '0xpool' }]);
      expect(store.getSeries('dex:arb|A/B|bidPool')).toEqual([]);
    });

    it('should clear existing data when snapshot is invalid', () => {
      store.record('old', 1, 1000);
      store.restore(null);

      expect(store.getKeys()).toEqual([]);
    });
  });

  // ── memory usage ──────────────────────────────────────────────
  describe('getKeyMemoryUsage', () => {
    it('should return null for unknown key', () => {
      expect(store.getKeyMemoryUsage('unknown')).toBeNull();
    });

    it('should return points count, positive bytes and bytesHuman', () => {
      store.record('key1', 1, 1000);
      store.record('key1', 2, 2000);
      const usage = store.getKeyMemoryUsage('key1');
      expect(usage).not.toBeNull();
      expect(usage!.key).toBe('key1');
      expect(usage!.points).toBe(2);
      expect(usage!.bytes).toBeGreaterThan(0);
      expect(usage!.bytesHuman).toMatch(/B|KB|MB/);
    });

    it('should increase bytes when more points are added', () => {
      store.record('k', 1, 1000);
      const before = store.getKeyMemoryUsage('k')!.bytes;
      store.record('k', 2, 2000);
      const after = store.getKeyMemoryUsage('k')!.bytes;
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('getMemoryUsageForKeys', () => {
    it('should skip missing keys silently', () => {
      store.record('existing', 1);
      const report = store.getMemoryUsageForKeys(['existing', 'missing']);
      expect(report.keys).toHaveLength(1);
      expect(report.keys[0].key).toBe('existing');
    });

    it('should sum total correctly', () => {
      store.record('a', 1, 1000);
      store.record('b', 2, 2000);
      const report = store.getMemoryUsageForKeys(['a', 'b']);
      const expectedBytes = report.keys[0].bytes + report.keys[1].bytes;
      expect(report.total.bytes).toBe(expectedBytes);
      expect(report.total.keys).toBe(2);
      expect(report.total.points).toBe(2);
    });
  });

  describe('getTotalMemoryUsage', () => {
    it('should return empty report for empty store', () => {
      const report = store.getTotalMemoryUsage();
      expect(report.total.keys).toBe(0);
      expect(report.total.bytes).toBe(0);
      expect(report.total.points).toBe(0);
      expect(report.keys).toHaveLength(0);
    });

    it('should cover all keys', () => {
      store.record('x', 10, 1000);
      store.record('y', 20, 2000);
      const report = store.getTotalMemoryUsage();
      expect(report.total.keys).toBe(2);
      expect(report.total.points).toBe(2);
      expect(report.keys.map((u) => u.key)).toEqual(expect.arrayContaining(['x', 'y']));
    });

    it('total.bytes should equal sum of individual key bytes', () => {
      store.record('p', 1, 1000);
      store.record('q', 2, 2000);
      const report = store.getTotalMemoryUsage();
      const sum = report.keys.reduce((acc, u) => acc + u.bytes, 0);
      expect(report.total.bytes).toBe(sum);
    });
  });
});

