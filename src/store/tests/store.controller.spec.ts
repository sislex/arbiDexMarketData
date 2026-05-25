import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StoreController } from '../store.controller';
import { StoreService } from '../store.service';
import { StoreGateway } from '../store.gateway';
import { WritePointDto } from '../dto/write-point.dto';
import { WriteBatchDto } from '../dto/write-batch.dto';
import { QuerySeriesDto } from '../dto/query-series.dto';
import { KeysQueryDto } from '../dto/keys-query.dto';
import { MemoryQueryDto } from '../dto/memory-query.dto';
import { WriteMetricsService } from '../write-metrics.service';

const mockStoreService = () => ({
  getKeys: jest.fn(),
  getKeysInfo: jest.fn(),
  getSnapshot: jest.fn(),
  getLastPoint: jest.fn(),
  getSeries: jest.fn(),
  write: jest.fn(),
  writeBatch: jest.fn(),
  deleteSeries: jest.fn(),
  clear: jest.fn(),
  getTotalMemoryUsage: jest.fn(),
  getKeyMemoryUsage: jest.fn(),
  getMemoryUsageForKeys: jest.fn(),
  getRecentSnapshot: jest.fn(),
});

const mockStoreGateway = () => ({
  getConnectedClients: jest.fn(),
  disconnectClient: jest.fn(),
});

const mockWriteMetricsService = () => ({
  recordAttempt: jest.fn(),
  recordMalformed: jest.fn(),
  getServiceMetrics: jest.fn(),
  getKeyMetrics: jest.fn(),
  getKeysMetrics: jest.fn(),
});

describe('StoreController', () => {
  let controller: StoreController;
  let service: ReturnType<typeof mockStoreService>;
  let gateway: ReturnType<typeof mockStoreGateway>;
  let writeMetricsService: ReturnType<typeof mockWriteMetricsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoreController],
      providers: [
        { provide: StoreService, useFactory: mockStoreService },
        { provide: StoreGateway, useFactory: mockStoreGateway },
        { provide: WriteMetricsService, useFactory: mockWriteMetricsService },
      ],
    }).compile();

    controller = module.get<StoreController>(StoreController);
    service = module.get(StoreService);
    gateway = module.get(StoreGateway);
    writeMetricsService = module.get(WriteMetricsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── GET /store/keys ──────────────────────────────────────────
  describe('getKeys', () => {
    it('should return plain array of keys when no flags', () => {
      service.getKeys.mockReturnValue(['a', 'b']);
      expect(controller.getKeys({})).toEqual(['a', 'b']);
      expect(service.getKeys).toHaveBeenCalledTimes(1);
      expect(service.getKeysInfo).not.toHaveBeenCalled();
    });

    it('should return enriched info when detail=true', () => {
      const info = [{ key: 'a', points: 2, firstTimestamp: 1000, lastTimestamp: 2000 }];
      service.getKeysInfo.mockReturnValue(info);
      expect(controller.getKeys({ detail: true })).toEqual(info);
      expect(service.getKeysInfo).toHaveBeenCalledWith({ detail: true, memory: undefined });
    });

    it('should return enriched info when memory=true', () => {
      const info = [{ key: 'a', bytes: 100, bytesHuman: '100 B' }];
      service.getKeysInfo.mockReturnValue(info);
      expect(controller.getKeys({ memory: true })).toEqual(info);
      expect(service.getKeysInfo).toHaveBeenCalledWith({ detail: undefined, memory: true });
    });

    it('should return enriched info when both flags are true', () => {
      const info = [{ key: 'a', points: 2, firstTimestamp: 1000, lastTimestamp: 2000, bytes: 100, bytesHuman: '100 B' }];
      service.getKeysInfo.mockReturnValue(info);
      expect(controller.getKeys({ detail: true, memory: true })).toEqual(info);
      expect(service.getKeysInfo).toHaveBeenCalledWith({ detail: true, memory: true });
    });
  });

  // ── GET /store/snapshot ──────────────────────────────────────
  describe('getSnapshot', () => {
    it('should return snapshot object', () => {
      const snap = { a: { t: 1000, v: 10 } };
      service.getSnapshot.mockReturnValue(snap);
      expect(controller.getSnapshot()).toEqual(snap);
    });
  });

  // ── GET /store/snapshot/recent ─────────────────────────────────
  describe('getRecentSnapshot', () => {
    it('should call with default limit 100 and no time range', () => {
      const snap = { a: { points: [{ t: 1000, v: 1 }], count: 1 } };
      service.getRecentSnapshot.mockReturnValue(snap);
      expect(controller.getRecentSnapshot({} as any)).toEqual(snap);
      expect(service.getRecentSnapshot).toHaveBeenCalledWith({ from: undefined, to: undefined, limit: 100 });
    });

    it('should pass custom limit and time range', () => {
      service.getRecentSnapshot.mockReturnValue({});
      controller.getRecentSnapshot({ limit: 50, from: 1000, to: 5000 } as any);
      expect(service.getRecentSnapshot).toHaveBeenCalledWith({ from: 1000, to: 5000, limit: 50 });
    });
  });

  // ── GET /store/key/:key/latest ───────────────────────────────
  describe('getLatest', () => {
    it('should return the last point when exists', () => {
      service.getLastPoint.mockReturnValue({ t: 1000, v: 42 });
      expect(controller.getLatest('key1')).toEqual({ t: 1000, v: 42 });
      expect(service.getLastPoint).toHaveBeenCalledWith('key1');
    });

    it('should throw NotFoundException when no data', () => {
      service.getLastPoint.mockReturnValue(null);
      expect(() => controller.getLatest('missing')).toThrow(NotFoundException);
    });
  });

  // ── GET /store/key/:key ──────────────────────────────────────
  describe('getSeries', () => {
    it('should call service with opts and return shaped result', () => {
      const pts = [{ t: 1000, v: 1 }, { t: 2000, v: 2 }];
      service.getSeries.mockReturnValue(pts);

      const query: QuerySeriesDto = { from: 1000, to: 2000, limit: 10 };
      const result = controller.getSeries('key1', query);

      expect(service.getSeries).toHaveBeenCalledWith('key1', { from: 1000, to: 2000, limit: 10 });
      expect(result).toEqual({ key: 'key1', points: pts, count: 2, last: pts[1] });
    });

    it('should return count=0 and last=null for empty series', () => {
      service.getSeries.mockReturnValue([]);
      const result = controller.getSeries('empty', {} as QuerySeriesDto);
      expect(result).toEqual({ key: 'empty', points: [], count: 0, last: null });
    });

    it('should return { key, value } for pool key', () => {
      service.getLastPoint.mockReturnValue({ v: '0xpool' });
      const result = controller.getSeries('dex:arb|A/B|bidPool', {} as QuerySeriesDto);
      expect(service.getLastPoint).toHaveBeenCalledWith('dex:arb|A/B|bidPool');
      expect(service.getSeries).not.toHaveBeenCalled();
      expect(result).toEqual({ key: 'dex:arb|A/B|bidPool', value: '0xpool' });
    });

    it('should return { key, value: null } for unknown pool key', () => {
      service.getLastPoint.mockReturnValue(null);
      const result = controller.getSeries('dex:arb|A/B|askPool', {} as QuerySeriesDto);
      expect(result).toEqual({ key: 'dex:arb|A/B|askPool', value: null });
    });
  });

  // ── POST /store/keys ─────────────────────────────────────────
  describe('getMultiSeries', () => {
    it('should return map of key → shaped result', () => {
      const pts = [{ t: 1000, v: 5 }];
      service.getSeries.mockReturnValue(pts);

      const body: KeysQueryDto = { keys: ['k1', 'k2'] };
      const result = controller.getMultiSeries(body);

      expect(service.getSeries).toHaveBeenCalledTimes(2);
      expect(result['k1']).toEqual({ points: pts, count: 1, last: pts[0] });
      expect(result['k2']).toEqual({ points: pts, count: 1, last: pts[0] });
    });
  });

  // ── POST /store/write ─────────────────────────────────────────
  describe('writePoint', () => {
    it('should call service.write and return success', () => {
      service.write.mockReturnValue('accepted');
      const dto: WritePointDto = { key: 'k1', value: 100, timestamp: 1000 };
      const result = controller.writePoint(dto);
      expect(service.write).toHaveBeenCalledWith('k1', 100, 1000);
      expect(writeMetricsService.recordAttempt).toHaveBeenCalledWith('rest', 'k1', 'accepted');
      expect(result).toEqual({ success: true });
    });
  });

  // ── POST /store/write/batch ───────────────────────────────────
  describe('writeBatch', () => {
    it('should call service.write for each point and return written count', () => {
      service.write.mockReturnValue('accepted');
      const dto: WriteBatchDto = {
        points: [
          { key: 'k1', value: 1 },
          { key: 'k2', value: 2 },
        ],
      };
      const result = controller.writeBatch(dto);
      expect(service.write).toHaveBeenCalledTimes(2);
      expect(writeMetricsService.recordAttempt).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ written: 2 });
    });
  });

  // ── Metrics: service/key/keys ────────────────────────────────
  describe('write metrics endpoints', () => {
    it('should return service write metrics', () => {
      const report = { scope: 'service', windows: {}, series: { rangeMinutes: 120, stepMinutes: 1, points: [] } };
      writeMetricsService.getServiceMetrics.mockReturnValue(report);

      expect(controller.getServiceWriteMetrics({ windows: ['1m'] } as any)).toEqual(report);
      expect(writeMetricsService.getServiceMetrics).toHaveBeenCalledWith({ windows: ['1m'], seriesMinutes: undefined, topLimit: undefined });
    });

    it('should return key write metrics', () => {
      const report = { key: 'k1', windows: {}, series: { rangeMinutes: 120, stepMinutes: 1, points: [] } };
      writeMetricsService.getKeyMetrics.mockReturnValue(report);

      expect(controller.getKeyWriteMetrics('k1', { windows: ['10m'] } as any)).toEqual(report);
      expect(writeMetricsService.getKeyMetrics).toHaveBeenCalledWith('k1', { windows: ['10m'], seriesMinutes: undefined });
    });

    it('should return grouped write metrics for keys', () => {
      const report = { scope: 'keys', keys: ['k1', 'k2'], windows: {}, perKey: {} };
      writeMetricsService.getKeysMetrics.mockReturnValue(report);

      expect(controller.getKeysWriteMetrics({ keys: ['k1', 'k2'], windows: ['1h'], seriesMinutes: 60 } as any)).toEqual(report);
      expect(writeMetricsService.getKeysMetrics).toHaveBeenCalledWith(['k1', 'k2'], { windows: ['1h'], seriesMinutes: 60 });
    });
  });

  // ── DELETE /store/key/:key ────────────────────────────────────
  describe('deleteSeries', () => {
    it('should call service.deleteSeries and return deleted', () => {
      const result = controller.deleteSeries('k1');
      expect(service.deleteSeries).toHaveBeenCalledWith('k1');
      expect(result).toEqual({ deleted: true });
    });
  });

  // ── DELETE /store ─────────────────────────────────────────────
  describe('clearStore', () => {
    it('should call service.clear and return cleared', () => {
      const result = controller.clearStore();
      expect(service.clear).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ cleared: true });
    });
  });

  // ── GET /store/memory ─────────────────────────────────────────
  describe('getTotalMemory', () => {
    it('should return total memory report', () => {
      const report = { keys: [], total: { keys: 0, points: 0, bytes: 0, bytesHuman: '0 B' } };
      service.getTotalMemoryUsage.mockReturnValue(report);
      expect(controller.getTotalMemory()).toEqual(report);
      expect(service.getTotalMemoryUsage).toHaveBeenCalledTimes(1);
    });
  });

  // ── GET /store/key/:key/memory ────────────────────────────────
  describe('getKeyMemory', () => {
    it('should return key memory usage when key exists', () => {
      const usage = { key: 'k1', points: 5, bytes: 200, bytesHuman: '200 B' };
      service.getKeyMemoryUsage.mockReturnValue(usage);
      expect(controller.getKeyMemory('k1')).toEqual(usage);
    });

    it('should throw NotFoundException when key does not exist', () => {
      service.getKeyMemoryUsage.mockReturnValue(null);
      expect(() => controller.getKeyMemory('missing')).toThrow(NotFoundException);
    });
  });

  // ── POST /store/memory/keys ───────────────────────────────────
  describe('getMemoryForKeys', () => {
    it('should return memory report for requested keys', () => {
      const report = {
        keys: [{ key: 'k1', points: 3, bytes: 150, bytesHuman: '150 B' }],
        total: { keys: 1, points: 3, bytes: 150, bytesHuman: '150 B' },
      };
      service.getMemoryUsageForKeys.mockReturnValue(report);
      const dto: MemoryQueryDto = { keys: ['k1'] };
      expect(controller.getMemoryForKeys(dto)).toEqual(report);
      expect(service.getMemoryUsageForKeys).toHaveBeenCalledWith(['k1']);
    });
  });

  // ── GET /store/clients ────────────────────────────────────────
  describe('getConnectedClients', () => {
    it('should return connected clients report from gateway', () => {
      const report = {
        total: 2,
        clients: [
          { id: 'abc', subscribedKeys: ['binance|ETHUSDT|bidPrice'], connectedAt: 1700000000000, connectedForMs: 5000, remoteAddress: '10.0.0.1', remotePort: 54321 },
          { id: 'def', subscribedKeys: 'all', connectedAt: 1700000001000, connectedForMs: 4000, remoteAddress: '10.0.0.2', remotePort: 60001 },
        ],
      };
      gateway.getConnectedClients.mockReturnValue(report);

      expect(controller.getConnectedClients()).toEqual(report);
      expect(gateway.getConnectedClients).toHaveBeenCalledTimes(1);
    });

    it('should return empty report when no clients connected', () => {
      gateway.getConnectedClients.mockReturnValue({ total: 0, clients: [] });
      expect(controller.getConnectedClients()).toEqual({ total: 0, clients: [] });
    });
  });

  // ── DELETE /store/clients/:id ─────────────────────────────────
  describe('disconnectClient', () => {
    it('should return disconnected: true when client exists', () => {
      gateway.disconnectClient.mockReturnValue(true);
      expect(controller.disconnectClient('abc123')).toEqual({ disconnected: true });
      expect(gateway.disconnectClient).toHaveBeenCalledWith('abc123');
    });

    it('should throw NotFoundException when client not found', () => {
      gateway.disconnectClient.mockReturnValue(false);
      expect(() => controller.disconnectClient('unknown')).toThrow(NotFoundException);
    });
  });
});

