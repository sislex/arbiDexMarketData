import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataPoint } from './interfaces/data-point.interface';
import { StoreService } from './store.service';
import { QuotesRepository } from './quotes.repository';
import { buildRowsToPersist } from './quote-sync.utils';

@Injectable()
export class QuoteSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuoteSyncService.name);
  private readonly syncIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isSyncRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly storeService: StoreService,
    private readonly quotesRepository: QuotesRepository,
  ) {
    this.syncIntervalMs = this.resolveSyncInterval();
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.syncNow();
    }, this.syncIntervalMs);

    void this.syncNow();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncNow(): Promise<void> {
    if (this.isSyncRunning) return;

    this.isSyncRunning = true;
    try {
      const seriesByKey = this.getNumericSeriesByKey();
      const keys = Array.from(seriesByKey.keys());
      if (keys.length === 0) return;

      const lastTimestampByKey = await this.quotesRepository.getLastTimestamps(keys);
      const rows = buildRowsToPersist(seriesByKey, lastTimestampByKey);
      if (rows.length === 0) return;

      const inserted = await this.quotesRepository.insertBatch(rows);
      this.logger.debug(`Quote sync inserted ${inserted} rows (prepared ${rows.length}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Quote sync failed: ${message}`);
    } finally {
      this.isSyncRunning = false;
    }
  }

  private getNumericSeriesByKey(): Map<string, DataPoint[]> {
    const result = new Map<string, DataPoint[]>();

    for (const key of this.storeService.getKeys()) {
      const series = this.storeService.getSeries(key);
      if (series.length > 0) {
        result.set(key, series);
      }
    }

    return result;
  }

  private resolveSyncInterval(): number {
    const value = this.configService.get<number>('SYNC_INTERVAL_MS', 60_000);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 60_000;
    }
    return Math.floor(value);
  }
}

