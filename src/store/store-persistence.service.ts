import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { StoreService } from './store.service';
import { StoreSnapshotData } from './data-store';

interface StoreSnapshotFile {
  version: 1;
  savedAt: string;
  data: StoreSnapshotData;
}

interface StoreSnapshotChunkRef {
  file: string;
  keys: number;
  points: number;
  bytes: number;
}

interface StoreSnapshotManifestFile {
  version: 1;
  savedAt: string;
  format: 'chunked';
  chunkSizeBytes: number;
  chunks: StoreSnapshotChunkRef[];
  total: {
    keys: number;
    points: number;
    bytes: number;
  };
}

interface StoreSnapshotChunkFile {
  version: 1;
  savedAt: string;
  part: number;
  data: StoreSnapshotData;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

@Injectable()
export class StorePersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorePersistenceService.name);
  private readonly snapshotPath: string;
  private readonly autosaveIntervalMs: number;
  private readonly restorePointsPerKey: number;
  private readonly snapshotChunkBytes: number;
  private autosaveTimer?: ReturnType<typeof setInterval>;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly storeService: StoreService,
    private readonly configService: ConfigService,
  ) {
    this.snapshotPath = resolve(
      this.configService.get<string>('SNAPSHOT_PATH', './data/store.snapshot.json'),
    );
    this.autosaveIntervalMs = toPositiveInt(
      this.configService.get('AUTOSAVE_INTERVAL_MS'),
      10_000,
    );
    this.restorePointsPerKey = toPositiveInt(
      this.configService.get('RESTORE_POINTS_PER_KEY'),
      10_000,
    );
    this.snapshotChunkBytes = toPositiveInt(
      this.configService.get('SNAPSHOT_CHUNK_BYTES'),
      10 * 1_024 * 1_024,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.loadSnapshot();
    this.startAutosave();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopAutosave();
    await this.saveSnapshot();
  }

  async loadSnapshot(): Promise<void> {
    try {
      const raw = await fs.readFile(this.snapshotPath, 'utf8');
      const parsed = JSON.parse(raw) as StoreSnapshotManifestFile | StoreSnapshotFile | StoreSnapshotData;
      const data = await this.extractSnapshotData(parsed);

      this.storeService.restoreSnapshot(data, { limitPerKey: this.restorePointsPerKey });

      const keys = this.storeService.getKeys().length;
      const points = this.storeService.getTotalMemoryUsage().total.points;
      this.logger.log(
        `Loaded store snapshot from ${this.snapshotPath}: ${keys} keys, ${points} points ` +
        `(latest ${this.restorePointsPerKey} points per key)`,
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        this.logger.log(`Store snapshot file not found, starting with empty store: ${this.snapshotPath}`);
        return;
      }
      this.logger.warn(`Failed to load store snapshot from ${this.snapshotPath}: ${error?.message ?? error}`);
    }
  }

  async saveSnapshot(): Promise<void> {
    const current = this.savePromise
      .catch(() => undefined)
      .then(() => this.writeSnapshotFile());
    this.savePromise = current.catch(() => undefined);
    return current;
  }

  private startAutosave(): void {
    this.stopAutosave();
    this.autosaveTimer = setInterval(() => {
      void this.saveSnapshot().catch((error) => {
        this.logger.warn(`Autosave failed: ${error?.message ?? error}`);
      });
    }, this.autosaveIntervalMs);
    this.autosaveTimer.unref?.();
    this.logger.log(`Store autosave enabled: every ${this.autosaveIntervalMs} ms → ${this.snapshotPath}`);
  }

  private stopAutosave(): void {
    if (this.autosaveTimer) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = undefined;
    }
  }

  private async extractSnapshotData(
    snapshot: StoreSnapshotManifestFile | StoreSnapshotFile | StoreSnapshotData,
  ): Promise<StoreSnapshotData> {
    if (this.isChunkedManifest(snapshot)) {
      const merged: StoreSnapshotData = {};
      for (const chunk of snapshot.chunks) {
        const chunkPath = resolve(dirname(this.snapshotPath), chunk.file);
        const raw = await fs.readFile(chunkPath, 'utf8');
        const parsed = JSON.parse(raw) as StoreSnapshotChunkFile | StoreSnapshotData;
        const chunkData = this.extractDirectSnapshotData(parsed);
        Object.assign(merged, chunkData);
      }
      return merged;
    }

    return this.extractDirectSnapshotData(snapshot);
  }

  private isChunkedManifest(snapshot: unknown): snapshot is StoreSnapshotManifestFile {
    return !!snapshot &&
      typeof snapshot === 'object' &&
      (snapshot as StoreSnapshotManifestFile).format === 'chunked' &&
      Array.isArray((snapshot as StoreSnapshotManifestFile).chunks);
  }

  private extractDirectSnapshotData(snapshot: StoreSnapshotFile | StoreSnapshotChunkFile | StoreSnapshotData): StoreSnapshotData {
    if (
      snapshot &&
      typeof snapshot === 'object' &&
      'data' in snapshot &&
      snapshot.data &&
      typeof snapshot.data === 'object' &&
      !Array.isArray(snapshot.data)
    ) {
      return snapshot.data;
    }

    return snapshot as StoreSnapshotData;
  }

  private async writeSnapshotFile(): Promise<void> {
    await fs.mkdir(dirname(this.snapshotPath), { recursive: true });

    const savedAt = new Date().toISOString();
    const generation = `${Date.now()}-${process.pid}`;
    const chunks = this.createChunks(this.storeService.exportSnapshot(), savedAt);
    const refs: StoreSnapshotChunkRef[] = [];
    let totalKeys = 0;
    let totalPoints = 0;
    let totalBytes = 0;

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const file = `${basename(this.snapshotPath)}.${generation}.part-${String(i + 1).padStart(6, '0')}.json`;
      const chunkPath = join(dirname(this.snapshotPath), file);
      const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8');
      const keys = Object.keys(chunk.data).length;
      const points = Object.values(chunk.data).reduce((sum, value) => {
        if (Array.isArray(value)) return sum + value.length;
        return typeof value?.value === 'string' ? sum + 1 : sum;
      }, 0);

      await this.writeJsonAtomic(chunkPath, chunk);
      refs.push({ file, keys, points, bytes });
      totalKeys += keys;
      totalPoints += points;
      totalBytes += bytes;
    }

    const manifest: StoreSnapshotManifestFile = {
      version: 1,
      savedAt,
      format: 'chunked',
      chunkSizeBytes: this.snapshotChunkBytes,
      chunks: refs,
      total: {
        keys: totalKeys,
        points: totalPoints,
        bytes: totalBytes,
      },
    };

    await this.writeJsonAtomic(this.snapshotPath, manifest);
    await this.cleanupOldChunkFiles(refs.map((r) => r.file));
  }

  private createChunks(data: StoreSnapshotData, savedAt: string): StoreSnapshotChunkFile[] {
    const chunks: StoreSnapshotChunkFile[] = [];
    let current: StoreSnapshotData = {};

    const pushCurrent = () => {
      chunks.push({ version: 1, savedAt, part: chunks.length + 1, data: current });
      current = {};
    };

    for (const [key, series] of Object.entries(data)) {
      const candidate = { ...current, [key]: series };
      const candidateChunk: StoreSnapshotChunkFile = {
        version: 1,
        savedAt,
        part: chunks.length + 1,
        data: candidate,
      };
      const candidateBytes = Buffer.byteLength(JSON.stringify(candidateChunk), 'utf8');

      if (Object.keys(current).length > 0 && candidateBytes > this.snapshotChunkBytes) {
        pushCurrent();
      }

      current[key] = series;
    }

    if (Object.keys(current).length > 0 || chunks.length === 0) {
      pushCurrent();
    }

    return chunks;
  }

  private async writeJsonAtomic(path: string, payload: unknown): Promise<void> {
    const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await fs.rename(tmpPath, path);
  }

  private async cleanupOldChunkFiles(currentFiles: string[]): Promise<void> {
    const dir = dirname(this.snapshotPath);
    const prefix = `${basename(this.snapshotPath)}.`;
    const keep = new Set(currentFiles);

    try {
      const files = await fs.readdir(dir);
      await Promise.all(files
        .filter((file) => file.startsWith(prefix) && file.includes('.part-') && file.endsWith('.json') && !keep.has(file))
        .map((file) => fs.rm(join(dir, file), { force: true })));
    } catch (error: any) {
      this.logger.warn(`Failed to cleanup old snapshot chunks: ${error?.message ?? error}`);
    }

  }
}



