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
        'for real-time subscriptions, JSON snapshot autosave/restore, ' +
        'and OpenAPI documentation for AI agent integration.',
      links: {
        swaggerUI: `${baseUrl}/api`,
        openApiJson: `${baseUrl}/api-json`,
        websocket: `${baseUrl}/store`,
      },
      endpoints: {
        'GET /store/keys': 'List all keys (add ?detail=true&memory=true for enriched info)',
        'GET /store/snapshot': 'Latest point per key',
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
      persistence: {
        snapshotPath: process.env.SNAPSHOT_PATH ?? './data/store.snapshot.json',
        autosaveIntervalMs: Number(process.env.AUTOSAVE_INTERVAL_MS ?? 10_000),
        restorePointsPerKey: Number(process.env.RESTORE_POINTS_PER_KEY ?? 10_000),
        snapshotChunkBytes: Number(process.env.SNAPSHOT_CHUNK_BYTES ?? 10 * 1_024 * 1_024),
      },
      authentication:
        'If API_KEY env var is set, supply it via x-api-key header or ?api_key= query param. ' +
        'If API_KEY is not configured, the API is open (development mode).',
    };
  }
}
