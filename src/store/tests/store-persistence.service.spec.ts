import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigService } from '@nestjs/config';
import { StoreService } from '../store.service';
import { StorePersistenceService } from '../store-persistence.service';

function createConfig(values: Record<string, any>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: any) => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue
    )),
  } as any;
}

describe('StorePersistenceService', () => {
  let dir: string;
  let snapshotPath: string;
  let storeService: StoreService;
  let persistence: StorePersistenceService;

  const createServices = (overrides: Record<string, any> = {}) => {
    const config = createConfig({
      MAX_POINTS_PER_KEY: 20_000,
      SNAPSHOT_PATH: snapshotPath,
      AUTOSAVE_INTERVAL_MS: 10_000,
      RESTORE_POINTS_PER_KEY: 10_000,
      SNAPSHOT_CHUNK_BYTES: 10 * 1_024 * 1_024,
      ...overrides,
    });
    storeService = new StoreService(config);
    persistence = new StorePersistenceService(storeService, config);
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arbidex-market-data-'));
    snapshotPath = join(dir, 'store.snapshot.json');
    createServices();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await rm(dir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('should save current store data to a chunked snapshot manifest', async () => {
    storeService.write('a', 1, 1000);
    storeService.write('a', 2, 2000);
    storeService.write('dex:arb|A/B|bidPool', '0xpool');

    await persistence.saveSnapshot();

    const raw = await readFile(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.savedAt).toEqual(expect.any(String));
    expect(parsed.format).toBe('chunked');
    expect(parsed.chunks).toHaveLength(1);

    const chunk = JSON.parse(await readFile(join(dir, parsed.chunks[0].file), 'utf8'));
    expect(chunk.data).toEqual({
      a: [{ t: 1000, v: 1 }, { t: 2000, v: 2 }],
      'dex:arb|A/B|bidPool': { value: '0xpool' },
    });
  });

  it('should split saved snapshot into multiple chunk files', async () => {
    createServices({ SNAPSHOT_CHUNK_BYTES: 80 });
    storeService.write('a', 1, 1000);
    storeService.write('b', 2, 2000);
    storeService.write('c', 3, 3000);

    await persistence.saveSnapshot();

    const manifest = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(manifest.format).toBe('chunked');
    expect(manifest.chunks.length).toBeGreaterThan(1);
    for (const chunk of manifest.chunks) {
      expect(await readFile(join(dir, chunk.file), 'utf8')).toBeTruthy();
    }
  });

  it('should load chunked snapshot manifest', async () => {
    const chunkFile = 'store.snapshot.json.test.part-000001.json';
    await writeFile(join(dir, chunkFile), JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      part: 1,
      data: { a: [{ t: 1000, v: 1 }], 'dex:arb|A/B|askPool': { value: '0xpool' } },
    }), 'utf8');
    await writeFile(snapshotPath, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      format: 'chunked',
      chunkSizeBytes: 10 * 1_024 * 1_024,
      chunks: [{ file: chunkFile, keys: 1, points: 1, bytes: 1 }],
      total: { keys: 1, points: 1, bytes: 1 },
    }), 'utf8');

    await persistence.loadSnapshot();

    expect(storeService.getSeries('a')).toEqual([{ t: 1000, v: 1 }]);
    expect(storeService.getSeries('dex:arb|A/B|askPool')).toEqual([{ v: '0xpool' }]);
  });

  it('should load only latest RESTORE_POINTS_PER_KEY points per key', async () => {
    const points = Array.from({ length: 10_005 }, (_, i) => ({ t: i, v: i }));
    await writeFile(snapshotPath, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), data: { a: points } }), 'utf8');

    await persistence.loadSnapshot();

    const restored = storeService.getSeries('a');
    expect(restored).toHaveLength(10_000);
    expect(restored[0]).toEqual({ t: 5, v: 5 });
    expect(restored[9_999]).toEqual({ t: 10_004, v: 10_004 });
  });


  it('should not throw when snapshot file does not exist', async () => {
    await expect(persistence.loadSnapshot()).resolves.toBeUndefined();
    expect(storeService.getKeys()).toEqual([]);
  });

  it('should not throw and should keep current data when snapshot JSON is invalid', async () => {
    storeService.write('current', 42, 1000);
    await writeFile(snapshotPath, '{ invalid json', 'utf8');

    await expect(persistence.loadSnapshot()).resolves.toBeUndefined();
    expect(storeService.getSeries('current')).toEqual([{ t: 1000, v: 42 }]);
  });

  it('should start autosave on module init and save on timer', async () => {
    jest.useFakeTimers();
    const saveSpy = jest.spyOn(persistence, 'saveSnapshot').mockResolvedValue(undefined);

    await persistence.onModuleInit();
    expect(saveSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10_000);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    await persistence.onModuleDestroy();
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });

  it('should save final snapshot on module destroy', async () => {
    storeService.write('final', 99, 1000);

    await persistence.onModuleDestroy();

    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const chunk = JSON.parse(await readFile(join(dir, parsed.chunks[0].file), 'utf8'));
    expect(chunk.data.final).toEqual([{ t: 1000, v: 99 }]);
  });

  it('should cleanup old chunk files after a successful save', async () => {
    await writeFile(join(dir, 'store.snapshot.json.old.part-000001.json'), '{}', 'utf8');
    storeService.write('fresh', 1, 1000);

    await persistence.saveSnapshot();

    const files = await readdir(dir);
    expect(files).not.toContain('store.snapshot.json.old.part-000001.json');
  });
});



