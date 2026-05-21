import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StoreModule } from './store/store.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    AuthModule,
    StoreModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
