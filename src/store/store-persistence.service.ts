import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { StoreService } from './store.service';
import { StoreSnapshotData } from './data-store';

interface LegacyStoreSnapshotFile {
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

interface LegacyStoreSnapshotManifestFile {
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

interface LegacyStoreSnapshotChunkFile {
  version: 1;
  savedAt: string;
  part: number;
  data: StoreSnapshotData;
}

interface StoreSnapshotPerKeyEntry {
  key: string;
  file: string;
  type: 'series' | 'pool';
  points: number;
  bytes: number;
}

interface StoreSnapshotManifestFile {
  version: 2;
  savedAt: string;
  format: 'per-key';
  generation: string;
  entries: StoreSnapshotPerKeyEntry[];
  total: {
    keys: number;
    points: number;
    bytes: number;
  };
}

interface StoreSnapshotKeyFile {
  version: 2;
  savedAt: string;
  generation: string;
  key: string;
  type: 'series' | 'pool';
  data: StoreSnapshotData[string];
}

function hasSnapshotDataField(value: unknown): value is LegacyStoreSnapshotFile | LegacyStoreSnapshotChunkFile {
  if (!value || typeof value !== 'object' || !('data' in value)) return false;
  const data = (value as { data?: unknown }).data;
  return !!data && typeof data === 'object' && !Array.isArray(data);
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
  private autosaveTimer?: ReturnType<typeof setInterval>;
  private savePromise: Promise<void> = Promise.resolve();
  private generationSeq = 0;

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
      const parsed = JSON.parse(raw) as
        | StoreSnapshotManifestFile
        | LegacyStoreSnapshotManifestFile
        | LegacyStoreSnapshotFile
        | StoreSnapshotData;
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
    snapshot: StoreSnapshotManifestFile | LegacyStoreSnapshotManifestFile | LegacyStoreSnapshotFile | StoreSnapshotData,
  ): Promise<StoreSnapshotData> {
    if (this.isPerKeyManifest(snapshot)) {
      const merged: StoreSnapshotData = {};
      for (const entry of snapshot.entries) {
        const keyPath = resolve(dirname(this.snapshotPath), entry.file);
        const raw = await fs.readFile(keyPath, 'utf8');
        const parsed = JSON.parse(raw) as StoreSnapshotKeyFile;

        // Restore only files from manifest's generation.
        if (parsed?.generation !== snapshot.generation) continue;
        if (parsed?.key !== entry.key) continue;
        if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) continue;

        merged[entry.key] = parsed.data;
      }
      return merged;
    }

    if (this.isChunkedManifest(snapshot)) {
      const merged: StoreSnapshotData = {};
      for (const chunk of snapshot.chunks) {
        const chunkPath = resolve(dirname(this.snapshotPath), chunk.file);
        const raw = await fs.readFile(chunkPath, 'utf8');
        const parsed = JSON.parse(raw) as LegacyStoreSnapshotChunkFile | StoreSnapshotData;
        const chunkData = this.extractDirectSnapshotData(parsed);
        Object.assign(merged, chunkData);
      }
      return merged;
    }

    return this.extractDirectSnapshotData(snapshot);
  }

  private isPerKeyManifest(snapshot: unknown): snapshot is StoreSnapshotManifestFile {
    return !!snapshot &&
      typeof snapshot === 'object' &&
      (snapshot as StoreSnapshotManifestFile).format === 'per-key' &&
      typeof (snapshot as StoreSnapshotManifestFile).generation === 'string' &&
      Array.isArray((snapshot as StoreSnapshotManifestFile).entries);
  }

  private isChunkedManifest(snapshot: unknown): snapshot is LegacyStoreSnapshotManifestFile {
    return !!snapshot &&
      typeof snapshot === 'object' &&
      (snapshot as LegacyStoreSnapshotManifestFile).format === 'chunked' &&
      Array.isArray((snapshot as LegacyStoreSnapshotManifestFile).chunks);
  }

  private extractDirectSnapshotData(snapshot: LegacyStoreSnapshotFile | LegacyStoreSnapshotChunkFile | StoreSnapshotData): StoreSnapshotData {
    if (hasSnapshotDataField(snapshot)) {
      return snapshot.data;
    }

    return snapshot as StoreSnapshotData;
  }

  private async writeSnapshotFile(): Promise<void> {
    await fs.mkdir(dirname(this.snapshotPath), { recursive: true });

    const savedAt = new Date().toISOString();
    this.generationSeq += 1;
    const generation = `${Date.now()}-${process.pid}-${this.generationSeq}`;
    const snapshot = this.storeService.exportSnapshot();
    const entries: StoreSnapshotPerKeyEntry[] = [];
    let totalKeys = 0;
    let totalPoints = 0;
    let totalBytes = 0;

    const records = Object.entries(snapshot);
    for (let i = 0; i < records.length; i += 1) {
      const [key, data] = records[i];
      const file = `${basename(this.snapshotPath)}.${generation}.key-${String(i + 1).padStart(6, '0')}.json`;
      const keyPath = join(dirname(this.snapshotPath), file);
      const type: 'series' | 'pool' = Array.isArray(data) ? 'series' : 'pool';
      const points = Array.isArray(data) ? data.length : 1;
      const keyFile: StoreSnapshotKeyFile = {
        version: 2,
        savedAt,
        generation,
        key,
        type,
        data,
      };
      const bytes = Buffer.byteLength(JSON.stringify(keyFile), 'utf8');

      // Atomicity: all key files first, manifest last.
      await this.writeJsonAtomic(keyPath, keyFile);
      entries.push({ key, file, type, points, bytes });
      totalKeys += 1;
      totalPoints += points;
      totalBytes += bytes;
    }

    const manifest: StoreSnapshotManifestFile = {
      version: 2,
      savedAt,
      format: 'per-key',
      generation,
      entries,
      total: {
        keys: totalKeys,
        points: totalPoints,
        bytes: totalBytes,
      },
    };

    await this.writeJsonAtomic(this.snapshotPath, manifest);
  }

  private async writeJsonAtomic(path: string, payload: unknown): Promise<void> {
    const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await fs.rename(tmpPath, path);
  }

  // Retention policy: keep all generations.
}



