import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StoreService } from '../store.service';

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, defaultVal?: any) => {
    if (key === 'MAX_POINTS_PER_KEY') return 10;
    return defaultVal;
  }),
};

describe('StoreService', () => {
  let service: StoreService;
  const pool1 = { dex: 'sushi', version: 'v3', poolAddress: '0xpool1' };
  const pool2 = { dex: 'camelot', version: 'v2', poolAddress: '0xpool2' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<StoreService>(StoreService);
  });

  afterEach(() => {
    service.clear();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── write + getSeries ────────────────────────────────────────
  describe('write / getSeries round-trip', () => {
    it('should write a point and retrieve it', () => {
      service.write('key1', 100, 1000);
      const points = service.getSeries('key1');
      expect(points).toEqual([{ t: 1000, v: 100 }]);
    });

    it('should filter by from/to/limit', () => {
      service.write('key1', 1, 1000);
      service.write('key1', 2, 2000);
      service.write('key1', 3, 3000);

      const byFrom = service.getSeries('key1', { from: 2000 });
      expect(byFrom).toHaveLength(2);

      const byLimit = service.getSeries('key1', { limit: 1 });
      expect(byLimit).toHaveLength(1);
      expect(byLimit[0].v).toBe(3);
    });

    it('should keep only last pool metadata and ignore timestamp', () => {
      const key = 'dex:arb|A/B|bidPool';
      service.write(key, pool1, 1000);
      service.write(key, pool2, 2000);
      const points = service.getSeries(key);
      expect(points).toEqual([{ v: pool2 }]);
      expect(service.getLastPoint(key)).toEqual({ v: pool2 });
    });
  });

  // ── writeBatch ───────────────────────────────────────────────
  describe('writeBatch', () => {
    it('should write all points', () => {
      service.writeBatch([
        { key: 'a', value: 1, timestamp: 1000 },
        { key: 'b', value: 2, timestamp: 2000 },
        { key: 'a', value: 3, timestamp: 3000 },
      ]);
      expect(service.getSeries('a')).toHaveLength(2);
      expect(service.getSeries('b')).toHaveLength(1);
    });
  });

  // ── getLastPoint ─────────────────────────────────────────────
  describe('getLastPoint', () => {
    it('should return null for unknown key', () => {
      expect(service.getLastPoint('unknown')).toBeNull();
    });

    it('should return the last point', () => {
      service.write('key1', 10, 1000);
      service.write('key1', 20, 2000);
      expect(service.getLastPoint('key1')).toEqual({ t: 2000, v: 20 });
    });
  });

  // ── getKeys ──────────────────────────────────────────────────
  describe('getKeys', () => {
    it('should return all keys', () => {
      service.write('x', 1);
      service.write('y', 2);
      expect(service.getKeys()).toEqual(expect.arrayContaining(['x', 'y']));
    });
  });

  // ── getKeysInfo ────────────────────────────────────────────
  describe('getKeysInfo', () => {
    it('should return enriched key info with detail flag', () => {
      service.write('a', 10, 1000);
      service.write('a', 20, 2000);
      const info = service.getKeysInfo({ detail: true });
      expect(info).toHaveLength(1);
      expect(info[0]).toMatchObject({ key: 'a', points: 2, firstTimestamp: 1000, lastTimestamp: 2000 });
    });

    it('should return enriched key info with memory flag', () => {
      service.write('a', 10, 1000);
      const info = service.getKeysInfo({ memory: true });
      expect(info[0].bytes).toBeGreaterThan(0);
      expect(info[0].bytesHuman).toBeDefined();
    });
  });

  // ── exportSnapshot / restoreSnapshot ────────────────────────
  describe('exportSnapshot / restoreSnapshot', () => {
    it('should export and restore store data', () => {
      service.write('a', 10, 1000);
      service.write('a', 20, 2000);
      service.write('b', 30, 3000);

      const snapshot = service.exportSnapshot();
      service.clear();
      service.restoreSnapshot(snapshot);

      expect(service.getSeries('a')).toEqual([{ t: 1000, v: 10 }, { t: 2000, v: 20 }]);
      expect(service.getSeries('b')).toEqual([{ t: 3000, v: 30 }]);
    });

    it('should keep only latest limitPerKey points while restoring', () => {
      service.restoreSnapshot({
        a: [
          { t: 1000, v: 1 },
          { t: 2000, v: 2 },
          { t: 3000, v: 3 },
        ],
      }, { limitPerKey: 2 });

      expect(service.getSeries('a')).toEqual([{ t: 2000, v: 2 }, { t: 3000, v: 3 }]);
    });
  });

  // ── deleteSeries ─────────────────────────────────────────────
  describe('deleteSeries', () => {
    it('should remove key', () => {
      service.write('key1', 1);
      service.deleteSeries('key1');
      expect(service.getKeys()).not.toContain('key1');
    });
  });

  // ── clear ────────────────────────────────────────────────────
  describe('clear', () => {
    it('should remove all data', () => {
      service.write('a', 1);
      service.write('b', 2);
      service.clear();
      expect(service.getKeys()).toHaveLength(0);
    });
  });

  // ── getSnapshot ──────────────────────────────────────────────
  describe('getSnapshot', () => {
    it('should return map of key → last point', () => {
      service.write('a', 10, 1000);
      service.write('a', 20, 2000);
      service.write('b', 99, 3000);
      service.write('dex:arb|A/B|askPool', pool1);
      const snap = service.getSnapshot();
      expect(snap['a']).toEqual({ t: 2000, v: 20 });
      expect(snap['b']).toEqual({ t: 3000, v: 99 });
      expect(snap['dex:arb|A/B|askPool']).toEqual({ value: pool1 });
    });
  });

  // ── getRecentSnapshot ──────────────────────────────────────────
  describe('getRecentSnapshot', () => {
    it('should return last N points per key', () => {
      service.write('a', 1, 1000);
      service.write('a', 2, 2000);
      service.write('a', 3, 3000);
      service.write('b', 10, 4000);

      const snap = service.getRecentSnapshot({ limit: 2 });
      expect(snap['a'].points).toHaveLength(2);
      expect(snap['a'].points[0].v).toBe(2);
      expect(snap['a'].points[1].v).toBe(3);
      expect(snap['a'].count).toBe(2);
      expect(snap['b'].points).toHaveLength(1);
      expect(snap['b'].count).toBe(1);
    });

    it('should default to 100 limit', () => {
      service.write('x', 1, 1000);
      const snap = service.getRecentSnapshot();
      expect(snap['x'].count).toBe(1);
    });

    it('should filter by from/to timestamps', () => {
      service.write('a', 1, 1000);
      service.write('a', 2, 2000);
      service.write('a', 3, 3000);
      service.write('a', 4, 4000);

      const snap = service.getRecentSnapshot({ from: 2000, to: 3000 });
      expect(snap['a'].points).toHaveLength(2);
      expect(snap['a'].points[0].v).toBe(2);
      expect(snap['a'].points[1].v).toBe(3);
    });

    it('should combine from/to with limit', () => {
      service.write('a', 1, 1000);
      service.write('a', 2, 2000);
      service.write('a', 3, 3000);
      service.write('a', 4, 4000);

      const snap = service.getRecentSnapshot({ from: 1000, to: 4000, limit: 2 });
      expect(snap['a'].points).toHaveLength(2);
      expect(snap['a'].points[0].v).toBe(3);
      expect(snap['a'].points[1].v).toBe(4);
    });
  });

  // ── maxPoints from config ────────────────────────────────────
  describe('maxPoints config', () => {
    it('should read MAX_POINTS_PER_KEY from ConfigService', () => {
      // maxPoints = 10, write 11 distinct values
      for (let i = 0; i < 11; i++) {
        service.write('key1', i + 1);
      }
      const series = service.getSeries('key1');
      expect(series.length).toBeLessThanOrEqual(10);
    });
  });

  // ── onChange / onAnyChange / onChangeMulti ───────────────────
  describe('subscriptions', () => {
    it('onChange should fire for a specific key', () => {
      const cb = jest.fn();
      service.onChange('key1', cb);
      service.write('key1', 42, 1000);
      expect(cb).toHaveBeenCalledWith({ t: 1000, v: 42 });
    });

    it('onAnyChange should fire for any key', () => {
      const cb = jest.fn();
      service.onAnyChange(cb);
      service.write('k1', 1, 1000);
      service.write('k2', 2, 2000);
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('onChangeMulti should fire for subscribed keys', () => {
      const cb = jest.fn();
      service.onChangeMulti(['k1', 'k2'], cb);
      service.write('k1', 1, 1000);
      service.write('k3', 3, 3000); // not subscribed
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith('k1', { t: 1000, v: 1 });
    });
  });
});

