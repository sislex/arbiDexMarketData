import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('arbiDexMarketData (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /store/keys ──────────────────────────────────────────
  describe('GET /store/keys', () => {
    it('should return an empty array on fresh start', () => {
      return request(app.getHttpServer())
        .get('/store/keys')
        .expect(200)
        .expect([]);
    });
  });

  // ── GET /store/snapshot ──────────────────────────────────────
  describe('GET /store/snapshot', () => {
    it('should return an empty object on fresh start', () => {
      return request(app.getHttpServer())
        .get('/store/snapshot')
        .expect(200)
        .expect({});
    });
  });

  // ── POST /store/write ────────────────────────────────────────
  describe('POST /store/write', () => {
    it('should write a point and return success', () => {
      return request(app.getHttpServer())
        .post('/store/write')
        .send({ key: 'e2e|TEST|bidPrice', value: 100.5, timestamp: 1700000001000 })
        .expect(201)
        .expect({ success: true });
    });

    it('should return 400 when key is missing', () => {
      return request(app.getHttpServer())
        .post('/store/write')
        .send({ value: 100 })
        .expect(400);
    });

    it('should return 400 when value is missing', () => {
      return request(app.getHttpServer())
        .post('/store/write')
        .send({ key: 'e2e|TEST|bidPrice' })
        .expect(400);
    });
  });

  // ── POST /store/write/batch ───────────────────────────────────
  describe('POST /store/write/batch', () => {
    it('should write multiple points', () => {
      return request(app.getHttpServer())
        .post('/store/write/batch')
        .send({
          points: [
            { key: 'e2e|BATCH|bidPrice', value: 1.1, timestamp: 1700000001000 },
            { key: 'e2e|BATCH|askPrice', value: 1.2, timestamp: 1700000001000 },
          ],
        })
        .expect(201)
        .expect({ written: 2 });
    });

    it('should return 400 when points array is missing', () => {
      return request(app.getHttpServer())
        .post('/store/write/batch')
        .send({})
        .expect(400);
    });
  });

  // ── GET /store/key/:key ───────────────────────────────────────
  describe('GET /store/key/:key', () => {
    const KEY = 'e2e|SERIES|bidPrice';

    beforeAll(() =>
      request(app.getHttpServer())
        .post('/store/write/batch')
        .send({
          points: [
            { key: KEY, value: 10, timestamp: 1700000001000 },
            { key: KEY, value: 20, timestamp: 1700000002000 },
            { key: KEY, value: 30, timestamp: 1700000003000 },
          ],
        }),
    );

    it('should return all points for a key', async () => {
      const res = await request(app.getHttpServer())
        .get(`/store/key/${encodeURIComponent(KEY)}`)
        .expect(200);

      expect(res.body.key).toBe(KEY);
      expect(res.body.count).toBe(3);
      expect(res.body.last.v).toBe(30);
    });

    it('should filter by limit', async () => {
      const res = await request(app.getHttpServer())
        .get(`/store/key/${encodeURIComponent(KEY)}?limit=2`)
        .expect(200);

      expect(res.body.count).toBe(2);
      expect(res.body.points[0].v).toBe(20);
      expect(res.body.points[1].v).toBe(30);
    });

    it('should filter by from timestamp', async () => {
      const res = await request(app.getHttpServer())
        .get(`/store/key/${encodeURIComponent(KEY)}?from=1700000002000`)
        .expect(200);

      expect(res.body.count).toBe(2);
      expect(res.body.points[0].v).toBe(20);
    });

    it('should filter by to timestamp', async () => {
      const res = await request(app.getHttpServer())
        .get(`/store/key/${encodeURIComponent(KEY)}?to=1700000002000`)
        .expect(200);

      expect(res.body.count).toBe(2);
      expect(res.body.points[1].v).toBe(20);
    });

    it('should return empty series for unknown key', async () => {
      const res = await request(app.getHttpServer())
        .get('/store/key/unknown%7Ckey')
        .expect(200);

      expect(res.body.count).toBe(0);
      expect(res.body.points).toEqual([]);
      expect(res.body.last).toBeNull();
    });
  });

  // ── GET /store/key/:key/latest ────────────────────────────────
  describe('GET /store/key/:key/latest', () => {
    const KEY = 'e2e|LATEST|bidPrice';

    beforeAll(() =>
      request(app.getHttpServer())
        .post('/store/write')
        .send({ key: KEY, value: 99, timestamp: 1700000005000 }),
    );

    it('should return the last point', async () => {
      const res = await request(app.getHttpServer())
        .get(`/store/key/${encodeURIComponent(KEY)}/latest`)
        .expect(200);

      expect(res.body).toEqual({ t: 1700000005000, v: 99 });
    });

    it('should return 404 for unknown key', () => {
      return request(app.getHttpServer())
        .get('/store/key/unknown%7Cmissing/latest')
        .expect(404);
    });
  });

  // ── POST /store/keys ──────────────────────────────────────────
  describe('POST /store/keys', () => {
    it('should return series for multiple keys', async () => {
      const res = await request(app.getHttpServer())
        .post('/store/keys')
        .send({ keys: ['e2e|LATEST|bidPrice', 'e2e|BATCH|bidPrice'] })
        .expect(200);

      expect(res.body['e2e|LATEST|bidPrice'].count).toBeGreaterThan(0);
      expect(res.body['e2e|BATCH|bidPrice'].count).toBeGreaterThan(0);
    });

    it('should return 400 when keys field is missing', () => {
      return request(app.getHttpServer())
        .post('/store/keys')
        .send({})
        .expect(400);
    });
  });

  // ── GET /store/snapshot ───────────────────────────────────────
  describe('GET /store/snapshot (after writes)', () => {
    it('should include previously written keys', async () => {
      const res = await request(app.getHttpServer())
        .get('/store/snapshot')
        .expect(200);

      expect(res.body['e2e|LATEST|bidPrice']).toBeDefined();
      expect(res.body['e2e|LATEST|bidPrice'].v).toBe(99);
    });
  });

  // ── DELETE /store/key/:key ────────────────────────────────────
  describe('DELETE /store/key/:key', () => {
    it('should delete a key', async () => {
      const KEY = 'e2e|DELETE|test';
      await request(app.getHttpServer())
        .post('/store/write')
        .send({ key: KEY, value: 1 });

      await request(app.getHttpServer())
        .delete(`/store/key/${encodeURIComponent(KEY)}`)
        .expect(200)
        .expect({ deleted: true });

      const res = await request(app.getHttpServer())
        .get(`/store/key/${encodeURIComponent(KEY)}`)
        .expect(200);

      expect(res.body.count).toBe(0);
    });
  });

  // ── DELETE /store ─────────────────────────────────────────────
  describe('DELETE /store', () => {
    it('should clear the entire store', async () => {
      await request(app.getHttpServer())
        .delete('/store')
        .expect(200)
        .expect({ cleared: true });

      return request(app.getHttpServer())
        .get('/store/keys')
        .expect(200)
        .expect([]);
    });
  });
});
