#!/usr/bin/env node

const { mkdir, rename, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { basename, dirname, join, resolve } = require('node:path');

const DEFAULT_SOURCE_URL = 'http://45.135.182.251:3002';
const DEFAULT_SNAPSHOT_PATH = './data/store.snapshot.json';
const DEFAULT_LIMIT_PER_KEY = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_RETRIES = 2;

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

function estimateKeyBytes(key, value) {
  return Buffer.byteLength(key, 'utf8') + Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function buildMemoryReport(data) {
  const keys = Object.entries(data).map(([key, value]) => {
    const bytes = estimateKeyBytes(key, value);
    const points = Array.isArray(value) ? value.length : 1;
    return { key, points, bytes, bytesHuman: formatBytes(bytes) };
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
  REQUEST_TIMEOUT_MS      Per-request timeout in milliseconds (default: ${DEFAULT_REQUEST_TIMEOUT_MS})
  REQUEST_RETRIES         Retries for failed requests (default: ${DEFAULT_REQUEST_RETRIES})
  API_KEY                 Optional API key, sent as x-api-key header

Example:
  SOURCE_URL=http://45.135.182.251:3002 SNAPSHOT_PATH=./data/store.snapshot.json RESTORE_POINTS_PER_KEY=10000 npm run snapshot:pull
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error) {
  const parts = [];
  if (error?.name) parts.push(error.name);
  if (error?.message) parts.push(error.message);
  if (error?.cause?.code) parts.push(`code=${error.cause.code}`);
  if (error?.cause?.message) parts.push(`cause=${error.cause.message}`);
  return parts.join(' | ') || String(error);
}

async function requestJson(url, apiKey, opts = {}) {
  const timeoutMs = positiveInt(opts.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  const retries = positiveInt(opts.retries, DEFAULT_REQUEST_RETRIES);
  const headers = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const response = await fetch(url, { headers, signal: ac.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}${text ? `: ${text}` : ''}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt > retries) break;
      await sleep(Math.min(2000, 250 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Request failed for ${url}: ${describeError(lastError)}`);
}

function normalizeKeys(payload) {
  if (!Array.isArray(payload)) {
    throw new Error('/store/keys response must be an array');
  }

  return payload
    .map((item) => (typeof item === 'string' ? item : item && typeof item.key === 'string' ? item.key : null))
    .filter((key) => typeof key === 'string' && key.length > 0);
}

function isPoolKey(key) {
  return key.endsWith('|bidPool') || key.endsWith('|askPool');
}

function normalizeValue(payload, key, limitPerKey) {
  if (isPoolKey(key)) {
    if (payload && typeof payload === 'object' && typeof payload.value === 'string') {
      return { value: payload.value };
    }
    return null;
  }

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

async function writeJsonAtomic(path, payload) {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(payload), 'utf8');
  await rename(tmpPath, path);
}

async function writeSnapshotFile(snapshotPath, data, meta) {
  const absolutePath = resolve(snapshotPath);
  const savedAt = new Date().toISOString();
  const generation = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const entries = [];
  let totalKeys = 0;
  let totalPoints = 0;
  let totalBytes = 0;

  await mkdir(dirname(absolutePath), { recursive: true });

  const records = Object.entries(data);
  for (let i = 0; i < records.length; i += 1) {
    const [key, keyData] = records[i];
    const type = Array.isArray(keyData) ? 'series' : 'pool';
    const file = `${basename(absolutePath)}.${generation}.key-${String(i + 1).padStart(6, '0')}.json`;
    const keyPath = join(dirname(absolutePath), file);
    const keyPayload = {
      version: 2,
      savedAt,
      generation,
      key,
      type,
      data: keyData,
    };
    const points = Array.isArray(keyData) ? keyData.length : 1;
    const bytes = Buffer.byteLength(JSON.stringify(keyPayload), 'utf8');

    await writeJsonAtomic(keyPath, keyPayload);
    entries.push({ key, file, type, points, bytes });
    totalKeys += 1;
    totalPoints += points;
    totalBytes += bytes;
  }

  const manifest = {
    version: 2,
    savedAt,
    format: 'per-key',
    generation,
    source: meta.sourceUrl,
    entries,
    total: {
      keys: totalKeys,
      points: totalPoints,
      bytes: totalBytes,
    },
  };

  await writeJsonAtomic(absolutePath, manifest);

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
  const requestTimeoutMs = positiveInt(process.env.REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
  const requestRetries = positiveInt(process.env.REQUEST_RETRIES, DEFAULT_REQUEST_RETRIES);
  const apiKey = process.env.API_KEY || '';

  console.log(`[snapshot:pull] Source: ${sourceUrl}`);
  console.log(`[snapshot:pull] Output: ${resolve(snapshotPath)}`);
  console.log(`[snapshot:pull] Limit per key: ${limitPerKey}`);
  console.log(`[snapshot:pull] Request timeout: ${requestTimeoutMs} ms`);
  console.log(`[snapshot:pull] Request retries: ${requestRetries}`);

  const requestOpts = { timeoutMs: requestTimeoutMs, retries: requestRetries };
  const keysPayload = await requestJson(`${sourceUrl}/store/keys`, apiKey, requestOpts);
  const keys = normalizeKeys(keysPayload);
  const data = {};
  let totalPoints = 0;

  console.log(`[snapshot:pull] Found keys: ${keys.length}`);

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const keyUrl = `${sourceUrl}/store/key/${encodeURIComponent(key)}?limit=${limitPerKey}`;
    let seriesPayload;
    try {
      seriesPayload = await requestJson(keyUrl, apiKey, requestOpts);
    } catch (error) {
      throw new Error(`Failed while pulling key ${i + 1}/${keys.length}: ${key}. ${error.message || error}`);
    }
    const value = normalizeValue(seriesPayload, key, limitPerKey);

    if (Array.isArray(value) && value.length > 0) {
      data[key] = value;
      totalPoints += value.length;
    }

    if (value && !Array.isArray(value)) {
      data[key] = value;
      totalPoints += 1;
    }

    if ((i + 1) % 10 === 0 || i + 1 === keys.length) {
      console.log(`[snapshot:pull] Processed ${i + 1}/${keys.length} keys, points: ${totalPoints}`);
    }
  }

  const memoryReport = buildMemoryReport(data);
  const { absolutePath, manifest } = await writeSnapshotFile(snapshotPath, data, { sourceUrl });
  console.log(`[snapshot:pull] Done: ${Object.keys(data).length} keys, ${totalPoints} points`);
  console.log(`[snapshot:pull] Snapshot files: ${manifest.entries.length}`);
  console.log(`[snapshot:pull] Snapshot saved: ${absolutePath}`);
  console.log('[snapshot:pull] Memory report:');
  console.log(JSON.stringify(memoryReport, null, 2));
}

main().catch((error) => {
  console.error(`[snapshot:pull] Failed: ${error.message || error}`);
  process.exitCode = 1;
});



