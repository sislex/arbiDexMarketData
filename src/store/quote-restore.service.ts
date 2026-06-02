import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuotesRepository } from './quotes.repository';
import { StoreService } from './store.service';

@Injectable()
export class QuoteRestoreService implements OnModuleInit {
  private readonly logger = new Logger(QuoteRestoreService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly quotesRepository: QuotesRepository,
    private readonly storeService: StoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.restoreNow();
  }

  async restoreNow(): Promise<void> {
    const limitPerKey = this.resolveRestoreLimit();

    try {
      const snapshot = await this.quotesRepository.getRecentSnapshot(limitPerKey);
      this.storeService.restoreSnapshot(snapshot, { limitPerKey });

      const keys = Object.keys(snapshot).length;
      const points = Object.values(snapshot).reduce((sum, series) => sum + series.length, 0);
      this.logger.log(`Restored ${points} points for ${keys} keys from Postgres (limitPerKey=${limitPerKey}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Restore from Postgres failed: ${message}`);
    }
  }

  private resolveRestoreLimit(): number {
    const configured = this.configService.get<number>('RESTORE_MAX_POINTS_PER_KEY', 5000);
    if (!Number.isFinite(configured) || configured <= 0) return 5000;
    return Math.min(Math.floor(configured), 5000);
  }
}

