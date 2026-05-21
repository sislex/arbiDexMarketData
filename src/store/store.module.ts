import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreGateway } from './store.gateway';
import { StorePersistenceService } from './store-persistence.service';

@Module({
  providers: [StoreService, StoreGateway, StorePersistenceService],
  controllers: [StoreController],
  exports: [StoreService, StoreGateway],
})
export class StoreModule {}

