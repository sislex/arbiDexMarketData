import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreGateway } from './store.gateway';
import { StorePersistenceService } from './store-persistence.service';
import { WriteMetricsService } from './write-metrics.service';

@Module({
  providers: [StoreService, StoreGateway, StorePersistenceService, WriteMetricsService],
  controllers: [StoreController],
  exports: [StoreService, StoreGateway],
})
export class StoreModule {}

