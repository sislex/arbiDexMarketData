import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StoreGateway } from '../store.gateway';
import { StoreService } from '../store.service';
import { WriteMetricsService } from '../write-metrics.service';

/** Minimal mock Socket */
const makeClient = (id = 'socket1', authKey?: string, queryKey?: string, ip = '127.0.0.1', port = 54321) => ({
  id,
  emit: jest.fn(),
  disconnect: jest.fn(),
  handshake: {
    address: ip,
    auth: authKey !== undefined ? { apiKey: authKey } : {},
    query: queryKey !== undefined ? { api_key: queryKey } : {},
  },
  request: { socket: { remotePort: port } },
});

const mockStoreService = () => ({
  onAnyChange: jest.fn(),
  onChangeMulti: jest.fn(),
  write: jest.fn().mockReturnValue('accepted'),
});

const mockWriteMetricsService = () => ({
  recordAttempt: jest.fn(),
  recordMalformed: jest.fn(),
});

const makeConfigService = (apiKey = '') =>
  ({ get: jest.fn().mockImplementation((_key: string, def = '') => apiKey || def) } as unknown as ConfigService);

describe('StoreGateway', () => {
  let gateway: StoreGateway;
  let service: ReturnType<typeof mockStoreService>;
  let writeMetricsService: ReturnType<typeof mockWriteMetricsService>;

  const buildModule = async (apiKey = '') => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreGateway,
        { provide: StoreService, useFactory: mockStoreService },
        { provide: ConfigService, useValue: makeConfigService(apiKey) },
        { provide: WriteMetricsService, useFactory: mockWriteMetricsService },
      ],
    }).compile();
    gateway = module.get<StoreGateway>(StoreGateway);
    service = module.get(StoreService);
    writeMetricsService = module.get(WriteMetricsService);
  };

  beforeEach(async () => {
    await buildModule(); // no API_KEY → auth disabled
  });

  afterEach(() => jest.clearAllMocks());

  // ── handleConnection ──────────────────────────────────────────
  describe('handleConnection', () => {
    it('should allow any connection when API_KEY is not configured', async () => {
      await buildModule('');
      const client = makeClient('c1');
      gateway.handleConnection(client as any);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should allow connection with correct auth.apiKey', async () => {
      await buildModule('secret');
      const client = makeClient('c2', 'secret');
      gateway.handleConnection(client as any);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should allow connection with correct query api_key', async () => {
      await buildModule('secret');
      const client = makeClient('c3', undefined, 'secret');
      gateway.handleConnection(client as any);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect client with wrong key', async () => {
      await buildModule('secret');
      const client = makeClient('c4', 'wrong');
      gateway.handleConnection(client as any);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.emit).toHaveBeenCalledWith('error', { message: 'Invalid or missing API key' });
    });

    it('should disconnect client with no key when auth is enabled', async () => {
      await buildModule('secret');
      const client = makeClient('c5');
      gateway.handleConnection(client as any);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  // ── subscribe (all) ──────────────────────────────────────────
  describe('handleSubscribe (no keys → all)', () => {
    it('should call onAnyChange and emit subscribed with "all"', () => {
      const unsub = jest.fn();
      service.onAnyChange.mockReturnValue(unsub);
      const client = makeClient();

      gateway.handleSubscribe(client as any, {});

      expect(service.onAnyChange).toHaveBeenCalledTimes(1);
      expect(service.onChangeMulti).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('subscribed', { keys: 'all' });
    });

    it('should treat empty keys array as subscribe-all', () => {
      const unsub = jest.fn();
      service.onAnyChange.mockReturnValue(unsub);
      const client = makeClient();

      gateway.handleSubscribe(client as any, { keys: [] });

      expect(service.onAnyChange).toHaveBeenCalledTimes(1);
      expect(client.emit).toHaveBeenCalledWith('subscribed', { keys: 'all' });
    });
  });

  // ── subscribe (specific keys) ────────────────────────────────
  describe('handleSubscribe (with keys)', () => {
    it('should call onChangeMulti and emit subscribed with keys array', () => {
      const unsub = jest.fn();
      service.onChangeMulti.mockReturnValue(unsub);
      const client = makeClient();
      const keys = ['k1', 'k2'];

      gateway.handleSubscribe(client as any, { keys });

      expect(service.onChangeMulti).toHaveBeenCalledTimes(1);
      expect(service.onChangeMulti).toHaveBeenCalledWith(keys, expect.any(Function));
      expect(client.emit).toHaveBeenCalledWith('subscribed', { keys });
    });

    it('should forward dataChange events to client', () => {
      let capturedCb: (key: string, point: any) => void;
      service.onChangeMulti.mockImplementation((_keys, cb) => {
        capturedCb = cb;
        return jest.fn();
      });
      const client = makeClient();

      gateway.handleSubscribe(client as any, { keys: ['k1'] });

      // Simulate a change event
      capturedCb!('k1', { t: 1000, v: 42 });

      expect(client.emit).toHaveBeenCalledWith('dataChange', { key: 'k1', point: { t: 1000, v: 42 } });
    });
  });

  // ── unsubscribe ──────────────────────────────────────────────
  describe('handleUnsubscribe', () => {
    it('should call unsub and emit unsubscribed', () => {
      const unsub = jest.fn();
      service.onAnyChange.mockReturnValue(unsub);
      const client = makeClient();

      gateway.handleSubscribe(client as any, {});
      gateway.handleUnsubscribe(client as any);

      expect(unsub).toHaveBeenCalledTimes(1);
      expect(client.emit).toHaveBeenCalledWith('unsubscribed', {});
    });

    it('should be safe to call without prior subscribe', () => {
      const client = makeClient('new');
      expect(() => gateway.handleUnsubscribe(client as any)).not.toThrow();
    });
  });

  // ── write ────────────────────────────────────────────────────
  describe('handleWrite', () => {
    it('should call service.write with correct args', () => {
      const client = makeClient();
      gateway.handleWrite(client as any, { key: 'k1', value: 3.14, timestamp: 1000 });
      expect(service.write).toHaveBeenCalledWith('k1', 3.14, 1000);
      expect(writeMetricsService.recordAttempt).toHaveBeenCalledWith('ws', 'k1', 'accepted');
    });

    it('should call service.write without timestamp', () => {
      const client = makeClient();
      gateway.handleWrite(client as any, { key: 'k1', value: 1 });
      expect(service.write).toHaveBeenCalledWith('k1', 1, undefined);
    });

    it('should write pool key as string without timestamp', () => {
      const client = makeClient();
      gateway.handleWrite(client as any, { key: 'dex:arb|A/B|bidPool', value: '0xpool' });
      expect(service.write).toHaveBeenCalledWith('dex:arb|A/B|bidPool', '0xpool', undefined);
    });

    it('should track invalid pool value via write result', () => {
      service.write.mockReturnValueOnce('invalid');
      const client = makeClient();
      gateway.handleWrite(client as any, { key: 'dex:arb|A/B|askPool', value: 123 as any });
      expect(service.write).toHaveBeenCalled();
      expect(writeMetricsService.recordAttempt).toHaveBeenCalledWith('ws', 'dex:arb|A/B|askPool', 'invalid');
    });

    it('should track invalid price value via write result', () => {
      service.write.mockReturnValueOnce('invalid');
      const client = makeClient();
      gateway.handleWrite(client as any, { key: 'k1', value: 'bad' as any });
      expect(service.write).toHaveBeenCalled();
      expect(writeMetricsService.recordAttempt).toHaveBeenCalledWith('ws', 'k1', 'invalid');
    });

    it('should not throw if payload is malformed', () => {
      const client = makeClient();
      expect(() => gateway.handleWrite(client as any, {} as any)).not.toThrow();
      expect(writeMetricsService.recordMalformed).toHaveBeenCalledWith('ws');
    });
  });

  // ── handleDisconnect ─────────────────────────────────────────
  describe('handleDisconnect', () => {
    it('should call unsub on disconnect', () => {
      const unsub = jest.fn();
      service.onAnyChange.mockReturnValue(unsub);
      const client = makeClient();

      gateway.handleSubscribe(client as any, {});
      gateway.handleDisconnect(client as any);

      expect(unsub).toHaveBeenCalledTimes(1);
    });

    it('should be safe to disconnect without prior subscribe', () => {
      const client = makeClient('new2');
      expect(() => gateway.handleDisconnect(client as any)).not.toThrow();
    });
  });

  // ── getConnectedClients ───────────────────────────────────────
  describe('getConnectedClients', () => {
    it('should return empty report when no clients connected', () => {
      const report = gateway.getConnectedClients();
      expect(report).toEqual({ total: 0, clients: [] });
    });

    it('should show client with null subscribedKeys after connection', () => {
      const client = makeClient('c1', undefined, undefined, '10.0.0.1', 12345);
      gateway.handleConnection(client as any);

      const report = gateway.getConnectedClients();
      expect(report.total).toBe(1);
      expect(report.clients[0].id).toBe('c1');
      expect(report.clients[0].subscribedKeys).toBeNull();
      expect(report.clients[0].connectedAt).toBeGreaterThan(0);
      expect(report.clients[0].connectedForMs).toBeGreaterThanOrEqual(0);
      expect(report.clients[0].remoteAddress).toBe('10.0.0.1');
      expect(report.clients[0].remotePort).toBe(12345);
    });

    it('should show client with specific keys after subscribe', () => {
      service.onChangeMulti.mockReturnValue(jest.fn());
      const client = makeClient('c1');
      gateway.handleConnection(client as any);
      gateway.handleSubscribe(client as any, { keys: ['k1', 'k2'] });

      const report = gateway.getConnectedClients();
      expect(report.total).toBe(1);
      expect(report.clients[0].subscribedKeys).toEqual(['k1', 'k2']);
    });

    it('should show "all" when subscribed to all keys', () => {
      service.onAnyChange.mockReturnValue(jest.fn());
      const client = makeClient('c1');
      gateway.handleConnection(client as any);
      gateway.handleSubscribe(client as any, {});

      const report = gateway.getConnectedClients();
      expect(report.clients[0].subscribedKeys).toBe('all');
    });

    it('should reset to null after unsubscribe', () => {
      service.onAnyChange.mockReturnValue(jest.fn());
      const client = makeClient('c1');
      gateway.handleConnection(client as any);
      gateway.handleSubscribe(client as any, {});
      gateway.handleUnsubscribe(client as any);

      const report = gateway.getConnectedClients();
      expect(report.clients[0].subscribedKeys).toBeNull();
    });

    it('should remove client after disconnect', () => {
      const client = makeClient('c1');
      gateway.handleConnection(client as any);
      gateway.handleDisconnect(client as any);

      const report = gateway.getConnectedClients();
      expect(report).toEqual({ total: 0, clients: [] });
    });

    it('connectedForMs should increase over time', async () => {
      const client = makeClient('c1');
      gateway.handleConnection(client as any);

      await new Promise(r => setTimeout(r, 20));

      const report = gateway.getConnectedClients();
      expect(report.clients[0].connectedForMs).toBeGreaterThanOrEqual(10);
    });

    it('should track multiple clients independently', () => {
      service.onAnyChange.mockReturnValue(jest.fn());
      service.onChangeMulti.mockReturnValue(jest.fn());

      const c1 = makeClient('c1');
      const c2 = makeClient('c2');
      const c3 = makeClient('c3');

      gateway.handleConnection(c1 as any);
      gateway.handleConnection(c2 as any);
      gateway.handleConnection(c3 as any);

      gateway.handleSubscribe(c1 as any, { keys: ['k1'] });
      gateway.handleSubscribe(c2 as any, {});
      // c3 stays unsubscribed

      const report = gateway.getConnectedClients();
      expect(report.total).toBe(3);

      const byId = Object.fromEntries(report.clients.map(c => [c.id, c]));
      expect(byId['c1'].subscribedKeys).toEqual(['k1']);
      expect(byId['c2'].subscribedKeys).toBe('all');
      expect(byId['c3'].subscribedKeys).toBeNull();
      // all should have timing and address fields
      for (const id of ['c1', 'c2', 'c3']) {
        expect(byId[id].connectedAt).toBeGreaterThan(0);
        expect(byId[id].connectedForMs).toBeGreaterThanOrEqual(0);
        expect(byId[id].remoteAddress).toBe('127.0.0.1');
        expect(byId[id].remotePort).toBe(54321);
      }
    });
  });

  // ── disconnectClient ──────────────────────────────────────────
  describe('disconnectClient', () => {
    it('should return false when client is not in clientKeys', () => {
      expect(gateway.disconnectClient('unknown')).toBe(false);
    });

    it('should call server.in().disconnectSockets() and return true when client is connected', () => {
      const disconnectSockets = jest.fn();
      (gateway as any).server = { in: jest.fn().mockReturnValue({ disconnectSockets }) };

      const client = makeClient('c1');
      gateway.handleConnection(client as any);

      const result = gateway.disconnectClient('c1');

      expect(result).toBe(true);
      expect((gateway as any).server.in).toHaveBeenCalledWith('c1');
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('should return false when server is not initialized', () => {
      (gateway as any).server = undefined;
      // client not in map → false without touching server
      expect(gateway.disconnectClient('c1')).toBe(false);
    });
  });
});

