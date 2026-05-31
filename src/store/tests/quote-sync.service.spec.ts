import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QuoteSyncService } from '../quote-sync.service';
import { StoreService } from '../store.service';
import { QuotesRepository } from '../quotes.repository';
import { DataPoint } from '../interfaces/data-point.interface';

describe('QuoteSyncService', () => {
  let service: QuoteSyncService;
  let storeService: jest.Mocked<Pick<StoreService, 'getKeys' | 'getSeries'>>;
  let quotesRepository: jest.Mocked<Pick<QuotesRepository, 'getLastTimestamps' | 'insertBatch'>>;

  beforeEach(async () => {
    jest.useFakeTimers();

    storeService = {
      getKeys: jest.fn(),
      getSeries: jest.fn(),
    };

    quotesRepository = {
      getLastTimestamps: jest.fn(),
      insertBatch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteSyncService,
        {
          provide: ConfigService,
          useValue: {
            get: (_key: string, defaultValue?: unknown) => defaultValue,
          },
        },
        { provide: StoreService, useValue: storeService },
        { provide: QuotesRepository, useValue: quotesRepository },
      ],
    }).compile();

    service = module.get<QuoteSyncService>(QuoteSyncService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('syncs only rows newer than last timestamp in DB', async () => {
    storeService.getKeys.mockReturnValue(['binance|ETHUSDT|bidPrice']);
    storeService.getSeries.mockReturnValue([{ t: 1000, v: 1 }, { t: 2000, v: 2 }, { t: 3000, v: 3 }] as DataPoint[]);
    quotesRepository.getLastTimestamps.mockResolvedValue(new Map([['binance|ETHUSDT|bidPrice', 2000]]));
    quotesRepository.insertBatch.mockResolvedValue(1);

    await service.syncNow();

    expect(quotesRepository.insertBatch).toHaveBeenCalledWith([
      { key: 'binance|ETHUSDT|bidPrice', t: 3000, v: 3 },
    ]);
  });

  it('does not write anything when there is no numeric data', async () => {
    storeService.getKeys.mockReturnValue(['dex|ETH/USDC|askPool']);
    storeService.getSeries.mockReturnValue([{ v: '0xpool' }] as DataPoint[]);
    quotesRepository.getLastTimestamps.mockResolvedValue(new Map());

    await service.syncNow();

    expect(quotesRepository.insertBatch).not.toHaveBeenCalled();
  });

  it('starts periodic sync on module init', async () => {
    storeService.getKeys.mockReturnValue([]);
    quotesRepository.getLastTimestamps.mockResolvedValue(new Map());

    service.onModuleInit();
    await Promise.resolve();

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(storeService.getKeys).toHaveBeenCalledTimes(2);
  });
});

