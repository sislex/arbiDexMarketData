import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreGateway } from './store.gateway';
import { WriteMetricsService } from './write-metrics.service';
import { QuoteSyncService } from './quote-sync.service';
import { QuotesRepository } from './quotes.repository';
import { QuoteRestoreService } from './quote-restore.service';

@Module({
  providers: [
    StoreService,
    StoreGateway,
    WriteMetricsService,
    QuotesRepository,
    QuoteRestoreService,
    QuoteSyncService,
  ],
  controllers: [StoreController],
  exports: [StoreService, StoreGateway],
})
export class StoreModule {}

