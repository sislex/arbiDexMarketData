import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreGateway } from './store.gateway';
import { WriteMetricsService } from './write-metrics.service';

@Module({
  providers: [StoreService, StoreGateway, WriteMetricsService],
  controllers: [StoreController],
  exports: [StoreService, StoreGateway],
})
export class StoreModule {}

