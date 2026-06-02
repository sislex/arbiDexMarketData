import { DataPoint } from '../interfaces/data-point.interface';
import { buildRowsToPersist, isNumericDataPoint } from '../quote-sync.utils';

describe('quote-sync.utils', () => {
  describe('isNumericDataPoint', () => {
    it('returns true for numeric point', () => {
      expect(isNumericDataPoint({ t: 1000, v: 1.25 })).toBe(true);
    });

    it('returns false for pool-like point', () => {
      expect(isNumericDataPoint({ v: { dex: 'sushi', version: 'v3', poolAddress: '0xpool' } } as DataPoint)).toBe(false);
    });
  });

  describe('buildRowsToPersist', () => {
    it('keeps only points newer than DB max timestamp per key', () => {
      const seriesByKey = new Map<string, DataPoint[]>([
        ['binance|ETHUSDT|bidPrice', [{ t: 1000, v: 1 }, { t: 2000, v: 2 }, { t: 3000, v: 3 }]],
      ]);
      const lastTs = new Map<string, number>([['binance|ETHUSDT|bidPrice', 2000]]);

      const rows = buildRowsToPersist(seriesByKey, lastTs);

      expect(rows).toEqual([{ key: 'binance|ETHUSDT|bidPrice', t: 3000, v: 3 }]);
    });

    it('skips non-numeric points', () => {
      const seriesByKey = new Map<string, DataPoint[]>([
        ['dex|ETH/USDC|bidPool', [{ v: { dex: 'sushi', version: 'v3', poolAddress: '0xpool' } }]],
        ['binance|ETHUSDT|bidPrice', [{ t: 1000, v: 10 }]],
      ]);

      const rows = buildRowsToPersist(seriesByKey, new Map());

      expect(rows).toEqual([{ key: 'binance|ETHUSDT|bidPrice', t: 1000, v: 10 }]);
    });
  });
});

