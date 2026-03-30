import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreGateway } from './store.gateway';

@Module({
  providers: [StoreService, StoreGateway],
  controllers: [StoreController],
  exports: [StoreService],
})
export class StoreModule {}

