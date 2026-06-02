import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QuoteRestoreService } from '../quote-restore.service';
import { QuotesRepository } from '../quotes.repository';
import { StoreService } from '../store.service';

describe('QuoteRestoreService', () => {
  let service: QuoteRestoreService;
  let quotesRepository: jest.Mocked<Pick<QuotesRepository, 'getRecentSnapshot'>>;
  let storeService: jest.Mocked<Pick<StoreService, 'restoreSnapshot'>>;

  beforeEach(async () => {
    quotesRepository = {
      getRecentSnapshot: jest.fn(),
    };

    storeService = {
      restoreSnapshot: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteRestoreService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((_key: string, defaultValue?: unknown) => defaultValue),
          },
        },
        { provide: QuotesRepository, useValue: quotesRepository },
        { provide: StoreService, useValue: storeService },
      ],
    }).compile();

    service = module.get<QuoteRestoreService>(QuoteRestoreService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('restores latest points with default max limit 5000', async () => {
    quotesRepository.getRecentSnapshot.mockResolvedValue({
      'binance|ETHUSDT|bidPrice': [{ t: 1000, v: 1 }, { t: 2000, v: 2 }],
    });

    await service.restoreNow();

    expect(quotesRepository.getRecentSnapshot).toHaveBeenCalledWith(5000);
    expect(storeService.restoreSnapshot).toHaveBeenCalledWith(
      { 'binance|ETHUSDT|bidPrice': [{ t: 1000, v: 1 }, { t: 2000, v: 2 }] },
      { limitPerKey: 5000 },
    );
  });

  it('caps configured limit at 5000', async () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'RESTORE_MAX_POINTS_PER_KEY') return 10_000;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteRestoreService,
        { provide: ConfigService, useValue: configService },
        { provide: QuotesRepository, useValue: quotesRepository },
        { provide: StoreService, useValue: storeService },
      ],
    }).compile();

    const cappedService = module.get<QuoteRestoreService>(QuoteRestoreService);
    quotesRepository.getRecentSnapshot.mockResolvedValue({});

    await cappedService.restoreNow();

    expect(quotesRepository.getRecentSnapshot).toHaveBeenCalledWith(5000);
    expect(storeService.restoreSnapshot).toHaveBeenCalledWith({}, { limitPerKey: 5000 });
  });
});

