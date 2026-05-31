import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class AppController {
  @Get()
  getServiceInfo(): any {
    const port = process.env.PORT ?? '3002';
    const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

    return {
      service: 'ArbiDex Market Data',
      version: '1.0',
      author: 'Razhnou Aliaksei',
      description:
        'Autonomous in-memory time-series store for numeric market data. ' +
        'Supports REST API for reading/writing data points, WebSocket (Socket.IO) ' +
        'for real-time subscriptions, and OpenAPI documentation for AI agent integration.',
      links: {
        swaggerUI: `${baseUrl}/api`,
        openApiJson: `${baseUrl}/api-json`,
        websocket: `${baseUrl}/store`,
      },
      endpoints: {
        'GET /store/keys': 'List all keys (add ?detail=true&memory=true for enriched info)',
        'GET /store/snapshot/recent': 'Last N points per key (?limit=100&from=&to=)',
        'GET /store/key/:key/latest': 'Latest point for a single key',
        'GET /store/key/:key': 'Time series for a key (?from=&to=&limit=)',
        'POST /store/keys': 'Time series for multiple keys (body: {keys[], from?, to?, limit?})',
        'POST /store/write': 'Write a single point (body: {key, value, timestamp?})',
        'POST /store/write/batch': 'Write multiple points (body: {points: [{key, value, timestamp?}]})',
        'DELETE /store/key/:key': 'Delete all data for a key',
        'DELETE /store': 'Clear entire store',
        'GET /store/memory': 'Memory usage for all keys',
        'GET /store/key/:key/memory': 'Memory usage for a single key',
        'POST /store/memory/keys': 'Memory usage for a list of keys',
        'GET /store/clients': 'Connected WebSocket clients',
        'DELETE /store/clients/:id': 'Disconnect a client by socket ID',
        'GET /store/metrics/writes/service': 'Write metrics for whole service (windows + minute series + topKeys)',
        'GET /store/metrics/writes/key/:key': 'Write metrics for a single key',
        'POST /store/metrics/writes/keys': 'Write metrics for selected keys (+ perKey block)',
      },
      websocket: {
        namespace: '/store',
        protocol: 'Socket.IO v4',
        events: {
          subscribe: 'Subscribe to key changes. Payload: {keys: string[]} or {keys: "all"}',
          unsubscribe: 'Unsubscribe from key changes. Payload: {keys: string[]}',
          write: 'Write a data point via WS. Payload: {key, value, timestamp?}',
          data: '(server → client) Emitted when a subscribed key changes. Payload: {key, point: {t, v}}',
        },
      },
      storage: {
        mode: 'in-memory only',
      },
      authentication:
        'If API_KEY env var is set, supply it via x-api-key header or ?api_key= query param. ' +
        'If API_KEY is not configured, the API is open (development mode).',
    };
  }
}
