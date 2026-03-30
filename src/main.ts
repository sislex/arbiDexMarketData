import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // WebSocket adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Validation
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Swagger / OpenAPI
  const config = new DocumentBuilder()
    .setTitle('ArbiDex Market Data')
    .setDescription(
      'In-memory time-series store for market data. ' +
      'Supports REST API for reading/writing, WebSocket (Socket.IO) for real-time subscriptions, ' +
      'and OpenAPI documentation for AI agents.\n\n' +
      '**Authentication:** if `API_KEY` is set in environment, supply it via `x-api-key` header or `?api_key=` query param. ' +
      'If `API_KEY` is not configured the API is open (development mode).',
    )
    .setVersion('1.0')
    .addTag('store')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`ArbiDex Market Data server is running on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api`);
  console.log(`OpenAPI JSON: http://localhost:${port}/api-json`);
}

bootstrap();
