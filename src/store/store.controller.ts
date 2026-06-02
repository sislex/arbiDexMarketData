import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StoreService } from './store.service';
import { StoreGateway } from './store.gateway';
import { WritePointDto } from './dto/write-point.dto';
import { WriteBatchDto } from './dto/write-batch.dto';
import { QuerySeriesDto } from './dto/query-series.dto';
import { KeysQueryDto } from './dto/keys-query.dto';
import { MemoryQueryDto } from './dto/memory-query.dto';
import { KeysListQueryDto } from './dto/keys-list-query.dto';
import { isPoolKey } from './store-key.utils';
import { WriteMetricsService } from './write-metrics.service';
import { WriteMetricsQueryDto } from './dto/write-metrics-query.dto';
import { WriteMetricsKeysDto } from './dto/write-metrics-keys.dto';
import { QuotesRepository } from './quotes.repository';
import { isPoolMetadata } from './interfaces/data-point.interface';

@ApiTags('store')
@Controller('store')
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly storeGateway: StoreGateway,
    private readonly writeMetricsService: WriteMetricsService,
    private readonly quotesRepository: QuotesRepository,
  ) {}

  // ── GET /store/keys ────────────────────────────────────────
  @Get('keys')
  @ApiOperation({
    summary: 'Get all keys, optionally with point count and memory usage',
    description:
      'Without query params returns a plain string array (backward-compatible). ' +
      '`?detail=true` adds point count and first/last timestamps per key. ' +
      '`?memory=true` adds estimated memory usage per key. Both flags can be combined.',
  })
  @ApiResponse({ status: 200, description: 'Array of keys (plain strings or enriched objects)' })
  getKeys(@Query() query: KeysListQueryDto): any {
    if (query.detail || query.memory) {
      return this.storeService.getKeysInfo({ detail: query.detail, memory: query.memory });
    }
    return this.storeService.getKeys();
  }


  // ── GET /store/snapshot/recent ─────────────────────────────
  @Get('snapshot/recent')
  @ApiOperation({
    summary: 'Get recent snapshot: all keys with their last N points',
    description:
      'Like `/store/snapshot` but returns last `limit` points per key instead of just one. ' +
      'Supports `from` / `to` timestamp filtering. Default limit is 100.',
  })
  @ApiResponse({ status: 200, description: 'Map of key → { points, count }' })
  getRecentSnapshot(@Query() query: QuerySeriesDto): Record<string, any> {
    return this.storeService.getRecentSnapshot({
      from: query.from,
      to: query.to,
      limit: query.limit ?? 100,
    });
  }

  // ── GET /store/key/:key/latest ─────────────────────────────
  @Get('key/:key/latest')
  @ApiOperation({ summary: 'Get latest point for a key' })
  @ApiParam({ name: 'key', example: 'binance|ETHUSDT|bidPrice' })
  @ApiResponse({ status: 200, description: 'Last DataPoint' })
  @ApiResponse({ status: 404, description: 'Key not found or no data' })
  getLatest(@Param('key') key: string): any {
    const point = this.storeService.getLastPoint(key);
    if (!point) throw new NotFoundException(`No data for key: ${key}`);
    return point;
  }

  // ── GET /store/key/:key ────────────────────────────────────
  @Get('key/:key')
  @ApiOperation({ summary: 'Get time series for a key with optional filtering' })
  @ApiParam({ name: 'key', example: 'binance|ETHUSDT|bidPrice' })
  @ApiResponse({ status: 200, description: 'Series response for price keys, or { key, value } with pool metadata for pool keys' })
  getSeries(@Param('key') key: string, @Query() query: QuerySeriesDto): any {
    if (isPoolKey(key)) {
      const point = this.storeService.getLastPoint(key);
      if (!point || !isPoolMetadata(point.v)) return { key, value: null };
      return { key, value: point.v };
    }

    const points = this.storeService.getSeries(key, {
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
    return {
      key,
      points,
      count: points.length,
      last: points.length > 0 ? points[points.length - 1] : null,
    };
  }

  // ── POST /store/keys ───────────────────────────────────────
  @Post('keys')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get time series for multiple keys' })
  @ApiResponse({ status: 200, description: 'Map of key → DataPoint[]' })
  getMultiSeries(@Body() body: KeysQueryDto): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of body.keys) {
      const points = this.storeService.getSeries(key, {
        from: body.from,
        to: body.to,
        limit: body.limit,
      });
      result[key] = { points, count: points.length, last: points.length > 0 ? points[points.length - 1] : null };
    }
    return result;
  }

  // ── POST /store/write ──────────────────────────────────────
  @Post('write')
  @ApiOperation({ summary: 'Write a single data point' })
  @ApiResponse({ status: 201, description: 'Point written successfully' })
  writePoint(@Body() dto: WritePointDto): { success: boolean } {
    this.writeMetricsService.recordAttempt('rest', dto.key, this.storeService.write(dto.key, dto.value, dto.timestamp));
    return { success: true };
  }

  // ── POST /store/write/batch ────────────────────────────────
  @Post('write/batch')
  @ApiOperation({ summary: 'Write multiple data points in one request' })
  @ApiResponse({ status: 201, description: 'Points written successfully' })
  writeBatch(@Body() dto: WriteBatchDto): { written: number } {
    for (const point of dto.points) {
      this.writeMetricsService.recordAttempt('rest', point.key, this.storeService.write(point.key, point.value, point.timestamp));
    }
    return { written: dto.points.length };
  }

  // ── GET /store/metrics/writes/service ───────────────────────
  @Get('metrics/writes/service')
  @ApiOperation({
    summary: 'Write load metrics for whole service',
    description:
      'Returns incoming/accepted/invalid write counts for requested windows and 1-minute series. ' +
      '`activeKeys` is calculated by the longest requested window. `topKeys` is available only for service scope.',
  })
  @ApiResponse({ status: 200, description: 'Service write metrics' })
  getServiceWriteMetrics(@Query() query: WriteMetricsQueryDto): any {
    return this.writeMetricsService.getServiceMetrics({
      windows: query.windows,
      seriesMinutes: query.seriesMinutes,
      topLimit: query.topLimit,
    });
  }

  // ── GET /store/metrics/writes/key/:key ──────────────────────
  @Get('metrics/writes/key/:key')
  @ApiOperation({
    summary: 'Write load metrics for a single key',
    description:
      'Returns the same windows and series shape as perKey in grouped endpoint. ' +
      '`isActive` is calculated by the longest requested window.',
  })
  @ApiParam({ name: 'key', example: 'binance|ETHUSDT|bidPrice' })
  @ApiResponse({ status: 200, description: 'Single key write metrics' })
  getKeyWriteMetrics(@Param('key') key: string, @Query() query: WriteMetricsQueryDto): any {
    return this.writeMetricsService.getKeyMetrics(key, {
      windows: query.windows,
      seriesMinutes: query.seriesMinutes,
    });
  }

  // ── POST /store/metrics/writes/keys ─────────────────────────
  @Post('metrics/writes/keys')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Write load metrics for selected keys',
    description:
      'Returns aggregate metrics for requested keys and `perKey` entries with the same shape as single-key endpoint. ' +
      '`activeKeys` is counted only among provided keys and by the longest requested window.',
  })
  @ApiResponse({ status: 200, description: 'Grouped key write metrics' })
  getKeysWriteMetrics(@Body() dto: WriteMetricsKeysDto): any {
    return this.writeMetricsService.getKeysMetrics(dto.keys, {
      windows: dto.windows,
      seriesMinutes: dto.seriesMinutes,
    });
  }

  // ── DELETE /store/key/:key ─────────────────────────────────
  @Delete('key/:key')
  @ApiOperation({ summary: 'Delete all data for a key' })
  @ApiParam({ name: 'key', example: 'binance|ETHUSDT|bidPrice' })
  @ApiResponse({ status: 200, description: 'Series deleted' })
  deleteSeries(@Param('key') key: string): { deleted: boolean } {
    this.storeService.deleteSeries(key);
    return { deleted: true };
  }

  // ── DELETE /store ──────────────────────────────────────────────
  @Delete()
  @ApiOperation({ summary: 'Clear entire store' })
  @ApiResponse({ status: 200, description: 'Store cleared' })
  clearStore(): { cleared: boolean } {
    this.storeService.clear();
    return { cleared: true };
  }

  // ── GET /store/memory ─────────────────────────────────────────
  @Get('memory')
  @ApiOperation({
    summary: 'Get estimated memory usage for all keys',
    description:
      'Returns per-key and aggregate estimated memory usage. ' +
      'Sizes are computed as the JSON-serialized byte length of key + data series.',
  })
  @ApiResponse({ status: 200, description: 'Memory usage report for all keys' })
  getTotalMemory(): any {
    return this.storeService.getTotalMemoryUsage();
  }

  // ── GET /store/key/:key/memory ────────────────────────────────
  @Get('key/:key/memory')
  @ApiOperation({ summary: 'Get estimated memory usage for a single key' })
  @ApiParam({ name: 'key', example: 'binance|ETHUSDT|bidPrice' })
  @ApiResponse({ status: 200, description: 'Memory usage for the key' })
  @ApiResponse({ status: 404, description: 'Key not found' })
  getKeyMemory(@Param('key') key: string): any {
    const usage = this.storeService.getKeyMemoryUsage(key);
    if (!usage) throw new NotFoundException(`No data for key: ${key}`);
    return usage;
  }

  // ── POST /store/memory/keys ───────────────────────────────────
  @Post('memory/keys')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get estimated memory usage for a list of keys' })
  @ApiResponse({ status: 200, description: 'Memory usage report for the requested keys' })
  getMemoryForKeys(@Body() dto: MemoryQueryDto): any {
    return this.storeService.getMemoryUsageForKeys(dto.keys);
  }

  // ── GET /store/db/keys/stats ───────────────────────────────────
  @Get('db/keys/stats')
  @ApiOperation({
    summary: 'Get key statistics from Postgres',
    description:
      'Returns total number of keys in DB and for each key: total records, first timestamp, and last timestamp.',
  })
  @ApiResponse({ status: 200, description: 'DB key stats' })
  getDbKeysStats(): Promise<any> {
    return this.quotesRepository.getKeysStats();
  }

  // ── GET /store/clients ────────────────────────────────────────
  @Get('clients')
  @ApiOperation({
    summary: 'Get connected WebSocket clients',
    description:
      'Returns all currently connected WebSocket clients with their socket ID, ' +
      'remote IP, remote port, subscription state, and connection duration. ' +
      '`subscribedKeys` is `null` when connected but not yet subscribed, ' +
      '`"all"` when subscribed to all keys, or an array of specific key strings.',
  })
  @ApiResponse({
    status: 200,
    description: 'Connected clients report',
    schema: {
      example: {
        total: 2,
        clients: [
          { id: 'abc123', subscribedKeys: ['binance|ETHUSDT|bidPrice'], connectedAt: 1700000000000, connectedForMs: 34200, remoteAddress: '192.168.1.10', remotePort: 54321 },
          { id: 'def456', subscribedKeys: 'all', connectedAt: 1700000001000, connectedForMs: 33200, remoteAddress: '10.0.0.5', remotePort: 60001 },
        ],
      },
    },
  })
  getConnectedClients(): any {
    return this.storeGateway.getConnectedClients();
  }

  // ── DELETE /store/clients/:id ─────────────────────────────────
  @Delete('clients/:id')
  @ApiOperation({
    summary: 'Disconnect a WebSocket client by socket ID',
    description: 'Forcefully disconnects the specified client. Returns 404 if the client is not connected.',
  })
  @ApiParam({ name: 'id', description: 'Socket ID of the client to disconnect', example: 'abc123' })
  @ApiResponse({ status: 200, description: 'Client disconnected', schema: { example: { disconnected: true } } })
  @ApiResponse({ status: 404, description: 'Client not found' })
  disconnectClient(@Param('id') id: string): { disconnected: boolean } {
    const ok = this.storeGateway.disconnectClient(id);
    if (!ok) throw new NotFoundException(`Client not found: ${id}`);
    return { disconnected: true };
  }
}


