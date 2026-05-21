#!/usr/bin/env node

const { mkdir, readdir, rename, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { basename, dirname, join, resolve } = require('node:path');

const DEFAULT_SOURCE_URL = 'http://45.135.182.251:3002';
const DEFAULT_SNAPSHOT_PATH = './data/store.snapshot.json';
const DEFAULT_LIMIT_PER_KEY = 10_000;
const DEFAULT_CHUNK_BYTES = 10 * 1_024 * 1_024;

function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;

  const raw = require('node:fs').readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_SOURCE_URL)
    .replace(/\/+$/, '')
    .replace(/\/api-json$/, '')
    .replace(/\/api$/, '');
}

function formatBytes(bytes) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(2)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

function estimateKeyBytes(key, series) {
  return Buffer.byteLength(key, 'utf8') + Buffer.byteLength(JSON.stringify(series), 'utf8');
}

function buildMemoryReport(data) {
  const keys = Object.entries(data).map(([key, series]) => {
    const bytes = estimateKeyBytes(key, series);
    return { key, points: series.length, bytes, bytesHuman: formatBytes(bytes) };
  });
  const totalBytes = keys.reduce((sum, item) => sum + item.bytes, 0);
  const totalPoints = keys.reduce((sum, item) => sum + item.points, 0);
  return {
    keys,
    total: {
      keys: keys.length,
      points: totalPoints,
      bytes: totalBytes,
      bytesHuman: formatBytes(totalBytes),
    },
  };
}

function usage() {
  console.log(`Usage:
  SOURCE_URL=http://old-host:3002 npm run snapshot:pull

Environment variables:
  SOURCE_URL              REST API base URL or Swagger URL of the running old service (default: ${DEFAULT_SOURCE_URL})
  SNAPSHOT_PATH           Output snapshot file (default: ${DEFAULT_SNAPSHOT_PATH})
  RESTORE_POINTS_PER_KEY  How many latest points to pull per key (default: ${DEFAULT_LIMIT_PER_KEY})
  SNAPSHOT_CHUNK_BYTES    Approximate max size of each snapshot part (default: ${DEFAULT_CHUNK_BYTES})
  API_KEY                 Optional API key, sent as x-api-key header

Example:
  SOURCE_URL=http://45.135.182.251:3002 SNAPSHOT_PATH=./data/store.snapshot.json RESTORE_POINTS_PER_KEY=10000 npm run snapshot:pull
`);
}

async function requestJson(url, apiKey) {
  const headers = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}${text ? `: ${text}` : ''}`);
  }

  return response.json();
}

function normalizeKeys(payload) {
  if (!Array.isArray(payload)) {
    throw new Error('/store/keys response must be an array');
  }

  return payload
    .map((item) => (typeof item === 'string' ? item : item && typeof item.key === 'string' ? item.key : null))
    .filter((key) => typeof key === 'string' && key.length > 0);
}

function normalizePoints(payload, key, limitPerKey) {
  const rawPoints = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.points)
      ? payload.points
      : [];

  return rawPoints
    .filter((point) => (
      point &&
      typeof point === 'object' &&
      Number.isFinite(point.t) &&
      Number.isFinite(point.v)
    ))
    .map((point) => ({ t: point.t, v: point.v }))
    .slice(-limitPerKey);
}

function createChunks(data, savedAt, chunkBytes) {
  const chunks = [];
  let current = {};

  const pushCurrent = () => {
    chunks.push({ version: 1, savedAt, part: chunks.length + 1, data: current });
    current = {};
  };

  for (const [key, series] of Object.entries(data)) {
    const candidate = { ...current, [key]: series };
    const candidatePayload = { version: 1, savedAt, part: chunks.length + 1, data: candidate };
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidatePayload), 'utf8');

    if (Object.keys(current).length > 0 && candidateBytes > chunkBytes) {
      pushCurrent();
    }

    current[key] = series;
  }

  if (Object.keys(current).length > 0 || chunks.length === 0) {
    pushCurrent();
  }

  return chunks;
}

async function writeJsonAtomic(path, payload) {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(payload), 'utf8');
  await rename(tmpPath, path);
}

async function cleanupOldChunkFiles(snapshotPath, currentFiles) {
  const dir = dirname(snapshotPath);
  const prefix = `${basename(snapshotPath)}.`;
  const keep = new Set(currentFiles);

  const files = await readdir(dir).catch(() => []);
  await Promise.all(files
    .filter((file) => file.startsWith(prefix) && file.includes('.part-') && file.endsWith('.json') && !keep.has(file))
    .map((file) => rm(join(dir, file), { force: true })));
}

async function writeSnapshotFile(snapshotPath, data, meta) {
  const absolutePath = resolve(snapshotPath);
  const savedAt = new Date().toISOString();
  const generation = `${Date.now()}-${process.pid}`;
  const chunks = createChunks(data, savedAt, meta.chunkBytes);
  const refs = [];
  let totalKeys = 0;
  let totalPoints = 0;
  let totalBytes = 0;

  await mkdir(dirname(absolutePath), { recursive: true });

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const file = `${basename(absolutePath)}.${generation}.part-${String(i + 1).padStart(6, '0')}.json`;
    const chunkPath = join(dirname(absolutePath), file);
    const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8');
    const keys = Object.keys(chunk.data).length;
    const points = Object.values(chunk.data).reduce((sum, series) => sum + series.length, 0);

    await writeJsonAtomic(chunkPath, chunk);
    refs.push({ file, keys, points, bytes });
    totalKeys += keys;
    totalPoints += points;
    totalBytes += bytes;
  }

  const manifest = {
    version: 1,
    savedAt,
    format: 'chunked',
    source: meta.sourceUrl,
    chunkSizeBytes: meta.chunkBytes,
    chunks: refs,
    total: {
      keys: totalKeys,
      points: totalPoints,
      bytes: totalBytes,
    },
  };

  await writeJsonAtomic(absolutePath, manifest);
  await cleanupOldChunkFiles(absolutePath, refs.map((ref) => ref.file));

  return { absolutePath, manifest };
}

async function main() {
  loadDotEnv();

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available. Use Node.js 18+ to run this script.');
  }

  const sourceUrl = normalizeBaseUrl(process.env.SOURCE_URL || process.env.MARKET_DATA_URL);
  const snapshotPath = process.env.SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
  const limitPerKey = positiveInt(process.env.RESTORE_POINTS_PER_KEY, DEFAULT_LIMIT_PER_KEY);
  const chunkBytes = positiveInt(process.env.SNAPSHOT_CHUNK_BYTES, DEFAULT_CHUNK_BYTES);
  const apiKey = process.env.API_KEY || '';

  console.log(`[snapshot:pull] Source: ${sourceUrl}`);
  console.log(`[snapshot:pull] Output: ${resolve(snapshotPath)}`);
  console.log(`[snapshot:pull] Limit per key: ${limitPerKey}`);
  console.log(`[snapshot:pull] Chunk size: ${chunkBytes} bytes (${formatBytes(chunkBytes)})`);

  const keysPayload = await requestJson(`${sourceUrl}/store/keys`, apiKey);
  const keys = normalizeKeys(keysPayload);
  const data = {};
  let totalPoints = 0;

  console.log(`[snapshot:pull] Found keys: ${keys.length}`);

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const keyUrl = `${sourceUrl}/store/key/${encodeURIComponent(key)}?limit=${limitPerKey}`;
    const seriesPayload = await requestJson(keyUrl, apiKey);
    const points = normalizePoints(seriesPayload, key, limitPerKey);

    if (points.length > 0) {
      data[key] = points;
      totalPoints += points.length;
    }

    if ((i + 1) % 100 === 0 || i + 1 === keys.length) {
      console.log(`[snapshot:pull] Processed ${i + 1}/${keys.length} keys, points: ${totalPoints}`);
    }
  }

  const memoryReport = buildMemoryReport(data);
  const { absolutePath, manifest } = await writeSnapshotFile(snapshotPath, data, { sourceUrl, chunkBytes });
  console.log(`[snapshot:pull] Done: ${Object.keys(data).length} keys, ${totalPoints} points`);
  console.log(`[snapshot:pull] Snapshot chunks: ${manifest.chunks.length}`);
  console.log(`[snapshot:pull] Snapshot saved: ${absolutePath}`);
  console.log('[snapshot:pull] Memory report:');
  console.log(JSON.stringify(memoryReport, null, 2));
}

main().catch((error) => {
  console.error(`[snapshot:pull] Failed: ${error.message || error}`);
  process.exitCode = 1;
});



