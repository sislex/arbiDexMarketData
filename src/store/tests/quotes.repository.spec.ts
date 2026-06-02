import { QuotesRepository } from '../quotes.repository';

describe('QuotesRepository', () => {
  const pgService = {
    query: jest.fn(),
  };

  let repository: QuotesRepository;

  beforeEach(() => {
    repository = new QuotesRepository(pgService as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getKeysStats', () => {
    it('maps DB aggregated rows to API shape', async () => {
      pgService.query.mockResolvedValue({
        rows: [
          {
            key: 'binance|ETHUSDT|bidPrice',
            records_count: '3',
            first_t: '1700000000000',
            last_t: '1700000002000',
          },
          {
            key: 'mexc|ETHUSDT|askPrice',
            records_count: 2,
            first_t: 1700000010000,
            last_t: 1700000015000,
          },
        ],
      });

      await expect(repository.getKeysStats()).resolves.toEqual({
        totalKeys: 2,
        keys: [
          {
            key: 'binance|ETHUSDT|bidPrice',
            count: 3,
            firstTimestamp: 1700000000000,
            lastTimestamp: 1700000002000,
          },
          {
            key: 'mexc|ETHUSDT|askPrice',
            count: 2,
            firstTimestamp: 1700000010000,
            lastTimestamp: 1700000015000,
          },
        ],
      });
    });

    it('returns empty response when table has no rows', async () => {
      pgService.query.mockResolvedValue({ rows: [] });

      await expect(repository.getKeysStats()).resolves.toEqual({
        totalKeys: 0,
        keys: [],
      });
    });
  });

  describe('getRecentSnapshot', () => {
    it('maps ranked rows to key->series snapshot', async () => {
      pgService.query.mockResolvedValue({
        rows: [
          { key: 'binance|ETHUSDT|bidPrice', t: '1700000001000', v: '3500.5' },
          { key: 'binance|ETHUSDT|bidPrice', t: 1700000002000, v: 3501.25 },
          { key: 'mexc|ETHUSDT|askPrice', t: '1700000010000', v: '3502.1' },
        ],
      });

      await expect(repository.getRecentSnapshot(5000)).resolves.toEqual({
        'binance|ETHUSDT|bidPrice': [
          { t: 1700000001000, v: 3500.5 },
          { t: 1700000002000, v: 3501.25 },
        ],
        'mexc|ETHUSDT|askPrice': [{ t: 1700000010000, v: 3502.1 }],
      });

      expect(pgService.query).toHaveBeenCalledWith(expect.stringContaining('ROW_NUMBER() OVER'), [5000]);
    });

    it('returns empty snapshot when no rows found', async () => {
      pgService.query.mockResolvedValue({ rows: [] });

      await expect(repository.getRecentSnapshot(5000)).resolves.toEqual({});
    });
  });
});

