# 🤖 Integration Guide — arbiDexMarketData

> **Author:** Razhnou Aliaksei  
> This document is intended for AI agents and developers who want to programmatically
> interact with the **arbiDexMarketData** market data service.

---

## 1. Project Overview

**arbiDexMarketData** is an autonomous NestJS 11 (TypeScript) service
that provides a universal **in-memory store of numeric time series**
indexed by arbitrary string keys.

### Purpose

The service acts as the **central market data hub** for the ArbiDex ecosystem:

- Accepts quotes from **arbiDexServerBots** (and any other producers) via REST or WebSocket
- Stores price history (up to 100 000 points per key, FIFO ring)
- Distributes data to consumers — trading bots, dashboards, analytics agents
- Supports **real-time subscriptions** via Socket.IO

### Stack

| Component | Technology |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript (strict) |
| WebSocket | Socket.IO (`@nestjs/platform-socket.io`) |
| Documentation | `@nestjs/swagger` + Swagger UI |
| Configuration | `@nestjs/config` + `.env` |
| Tests | Jest (unit, 61 tests) |
| Container | Docker + docker-compose |

---

## 2. Running the Service

```bash
# Install dependencies
npm install

# Development mode (watch)
npm run start:dev

# Production build
npm run build && npm run start:prod

# Docker (recommended for production)
npm run start:docker    # docker compose up --build -d
npm run stop:docker     # docker compose down
npm run logs:docker     # docker compose logs -f

# Tests
npm test
npm run test:cov        # with coverage
```

### Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP/WS server port |
| `MAX_POINTS_PER_KEY` | `100000` | Maximum points per key (FIFO ring) |
| `API_KEY` | _(empty)_ | API key. If not set — auth is disabled (dev mode) |

---

## 3. Authentication (API Key)

The service supports optional API key authentication.

### Enabling

In `.env`, uncomment and set the variable:

```bash
# Generate a secure key:
openssl rand -hex 32

# Write to .env:
API_KEY=your-secret-key
```

If `API_KEY` is **not set** (or is an empty string) — authentication is **disabled** (dev mode, all requests pass).

### REST API

Pass the key in one of two ways (priority: header > query):

```bash
# Header (recommended)
curl -H "x-api-key: your-secret-key" http://localhost:3001/store/keys

# Query param
curl "http://localhost:3001/store/keys?api_key=your-secret-key"
```

If the key is invalid or missing — `401 Unauthorized`.

### WebSocket (Socket.IO)

Pass the key in the handshake:

```typescript
// auth object (recommended)
const socket = io('http://localhost:3001/store', {
  auth: { apiKey: 'your-secret-key' }
});

// or query param
const socket = io('http://localhost:3001/store', {
  query: { api_key: 'your-secret-key' }
});
```

If the key is invalid, the server emits `error { message: 'Invalid or missing API key' }` and disconnects.

### Swagger UI

When authentication is enabled, click the **Authorize** button in Swagger UI (`http://localhost:3001/api`) and enter the API key in the `x-api-key` field.

---

## 4. Data Format

### DataPoint

```typescript
interface DataPoint {
  t: number;  // timestamp (ms), Unix epoch — Date.now()
  v: number;  // numeric value
}
```

### Key

A key is an arbitrary string. For compatibility with **arbiDexServerBots**, the following format is used:

```
<source>|<symbol>|<field>
```

Examples:
```
binance|ETHUSDT|bidPrice
binance|ETHUSDT|askPrice
mexc|ETHUSDT|bidPrice
bybit|ETHUSDT|askPrice
okx|ETH-USDT|bidPrice
kucoin|ETH-USDT|askPrice
gateio|ETH_USDT|askPrice
dex:arbitrum|WETH/USDC|bidPrice
```

### Deduplication

If the written value is **unchanged** compared to the last stored point — the new point is **not written**.
This allows precise detection of periods when the price was constant.

---

## 5. REST API

**Base URL:** `http://localhost:3001`  
**OpenAPI JSON:** `http://localhost:3001/api-json`  
**Swagger UI:** `http://localhost:3001/api`

### 5.1 Reading Data

#### `GET /store/keys`
Returns the list of all keys that have data.

```bash
curl http://localhost:3001/store/keys
# → ["binance|ETHUSDT|bidPrice", "mexc|ETHUSDT|askPrice", ...]
```

---

#### `GET /store/snapshot`
Snapshot: all keys with their **latest** point.

```bash
curl http://localhost:3001/store/snapshot
# → { "binance|ETHUSDT|bidPrice": { "t": 1700000001000, "v": 3500.5 }, ... }
```

---

#### `GET /store/key/:key`
Time series for a key. Supports filtering:

| Query param | Type | Description |
|---|---|---|
| `from` | number (ms) | Range start (inclusive) |
| `to` | number (ms) | Range end (inclusive) |
| `limit` | integer ≥ 1 | Return the last N points |

```bash
# All points
curl "http://localhost:3001/store/key/binance%7CETHUSDT%7CbidPrice"

# Last 50 points
curl "http://localhost:3001/store/key/binance%7CETHUSDT%7CbidPrice?limit=50"

# Time range
curl "http://localhost:3001/store/key/binance%7CETHUSDT%7CbidPrice?from=1700000000000&to=1700000099000"
```

**Response:**
```json
{
  "key": "binance|ETHUSDT|bidPrice",
  "points": [
    { "t": 1700000001000, "v": 3500.5 },
    { "t": 1700000002000, "v": 3501.0 }
  ],
  "count": 2,
  "last": { "t": 1700000002000, "v": 3501.0 }
}
```

---

#### `GET /store/key/:key/latest`
Only the latest point for the key. Returns `404` if the key does not exist.

```bash
curl "http://localhost:3001/store/key/binance%7CETHUSDT%7CbidPrice/latest"
# → { "t": 1700000002000, "v": 3501.0 }
```

---

#### `POST /store/keys`
Series for multiple keys at once (+ optional filtering).

```bash
curl -X POST http://localhost:3001/store/keys \
  -H 'Content-Type: application/json' \
  -d '{
    "keys": ["binance|ETHUSDT|bidPrice", "mexc|ETHUSDT|askPrice"],
    "limit": 10
  }'
```

**Response:**
```json
{
  "binance|ETHUSDT|bidPrice": { "points": [...], "count": 10, "last": { "t": ..., "v": ... } },
  "mexc|ETHUSDT|askPrice":    { "points": [...], "count": 10, "last": { "t": ..., "v": ... } }
}
```

---

### 5.2 Writing Data

#### `POST /store/write`
Write a single point.

```bash
curl -X POST http://localhost:3001/store/write \
  -H 'Content-Type: application/json' \
  -d '{ "key": "binance|ETHUSDT|bidPrice", "value": 3500.5 }'

# With explicit timestamp
curl -X POST http://localhost:3001/store/write \
  -H 'Content-Type: application/json' \
  -d '{ "key": "binance|ETHUSDT|bidPrice", "value": 3500.5, "timestamp": 1700000001000 }'
```

**Response:** `201 { "success": true }`

---

#### `POST /store/write/batch`
Write an array of points in a single request (more efficient for batch producers).

```bash
curl -X POST http://localhost:3001/store/write/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "points": [
      { "key": "binance|ETHUSDT|bidPrice", "value": 3500.5 },
      { "key": "binance|ETHUSDT|askPrice", "value": 3501.0 },
      { "key": "mexc|ETHUSDT|bidPrice",    "value": 3499.8 }
    ]
  }'
```

**Response:** `201 { "written": 3 }`

---

### 5.3 Deleting Data

#### `DELETE /store/key/:key`
Delete the series for a key.

```bash
curl -X DELETE "http://localhost:3001/store/key/binance%7CETHUSDT%7CbidPrice"
# → { "deleted": true }
```

#### `DELETE /store`
Clear **the entire** store.

```bash
curl -X DELETE http://localhost:3001/store
# → { "cleared": true }
```

---

### 5.4 Memory Usage

The service stores data in process memory. These endpoints allow tracking how much memory each key consumes. Size is computed as the JSON-serialized byte length of the key string + points array — deterministic and consistent across all platforms.

#### `GET /store/memory`
Report for **all** keys.

```bash
curl http://localhost:3001/store/memory
```

**Response:**
```json
{
  "keys": [
    { "key": "binance|ETHUSDT|bidPrice", "points": 1024, "bytes": 28672, "bytesHuman": "28.00 KB" },
    { "key": "mexc|ETHUSDT|askPrice",    "points": 512,  "bytes": 14336, "bytesHuman": "14.00 KB" }
  ],
  "total": {
    "keys": 2,
    "points": 1536,
    "bytes": 43008,
    "bytesHuman": "42.00 KB"
  }
}
```

---

#### `GET /store/key/:key/memory`
Memory for a **single** key. Returns `404` if the key does not exist.

```bash
curl "http://localhost:3001/store/key/binance%7CETHUSDT%7CbidPrice/memory"
# → { "key": "binance|ETHUSDT|bidPrice", "points": 1024, "bytes": 28672, "bytesHuman": "28.00 KB" }
```

---

#### `POST /store/memory/keys`
Memory for a **list** of keys. Non-existent keys are silently skipped.

```bash
curl -X POST http://localhost:3001/store/memory/keys \
  -H 'Content-Type: application/json' \
  -d '{ "keys": ["binance|ETHUSDT|bidPrice", "mexc|ETHUSDT|askPrice"] }'
```

**Response:** same `MemoryUsageReport` structure as `GET /store/memory`.

---

## 6. WebSocket API (Socket.IO)

**Namespace:** `/store`  
**URL:** `ws://localhost:3001/store`

> **Machine-readable contract:** [`asyncapi.json`](./asyncapi.json) — AsyncAPI 2.6 specification of all events, schemas, and examples.

### 6.1 Connecting (socket.io-client)

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001/store');

socket.on('connect', () => console.log('Connected:', socket.id));
```

### 6.2 Subscribing to Specific Keys

```typescript
socket.emit('subscribe', {
  keys: [
    'binance|ETHUSDT|bidPrice',
    'mexc|ETHUSDT|askPrice',
  ]
});

socket.on('subscribed', (info) => {
  console.log('Subscribed to:', info.keys); // string[]
});

socket.on('dataChange', (data: { key: string; point: { t: number; v: number } }) => {
  console.log(`${data.key} → ${data.point.v} @ ${new Date(data.point.t).toISOString()}`);
});
```

### 6.3 Subscribing to ALL Keys

```typescript
socket.emit('subscribe', {});           // empty object
// or
socket.emit('subscribe', { keys: [] }); // empty array

socket.on('subscribed', (info) => {
  console.log(info.keys); // 'all'
});
```

### 6.4 Writing via WebSocket

```typescript
socket.emit('write', {
  key: 'binance|ETHUSDT|bidPrice',
  value: 3500.5,
  timestamp: Date.now(), // optional
});
```

### 6.5 Unsubscribing

```typescript
socket.emit('unsubscribe');
socket.on('unsubscribed', () => console.log('Unsubscribed'));
```

### 6.6 Event Reference

| Direction | Event | Payload | Description |
|---|---|---|---|
| Client → Server | `subscribe` | `{ keys?: string[] }` | Subscribe. Without `keys` — subscribe to all |
| Client → Server | `unsubscribe` | — | Cancel subscription |
| Client → Server | `write` | `{ key, value, timestamp? }` | Write a point |
| Server → Client | `subscribed` | `{ keys: string[] \| 'all' }` | Subscription confirmed |
| Server → Client | `unsubscribed` | `{}` | Unsubscription confirmed |
| Server → Client | `dataChange` | `{ key: string, point: DataPoint }` | New value arrived |

### 6.7 Connecting Without socket.io-client (raw Engine.IO)

```
1. GET  http://localhost:3001/store/socket.io/?EIO=4&transport=polling  → get sid
2. WS   ws://localhost:3001/store/socket.io/?EIO=4&transport=websocket&sid=<sid>
3. → send: 40
4. ← receive: 40{"sid":"..."}
5. → send subscribe: 42["subscribe",{"keys":["binance|ETHUSDT|bidPrice"]}]
6. ← receive: 42["dataChange",{"key":"binance|ETHUSDT|bidPrice","point":{"t":...,"v":...}}]
```

---

## 7. Integration with arbiDexServerBots

**arbiDexServerBots** collects quotes and stores them in its internal `PriceStore`.
To mirror data into **arbiDexMarketData**, add a call after writing to `PriceStore`:

```typescript
// In a job after receiving a quote:
priceStore.recordQuote(quote);

// Additionally — send to arbiDexMarketData:
await fetch('http://localhost:3001/store/write/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    points: [
      { key: `${quote.source}|${quote.symbol}|bidPrice`, value: quote.bidPrice, timestamp: quote.timestamp },
      { key: `${quote.source}|${quote.symbol}|askPrice`, value: quote.askPrice, timestamp: quote.timestamp },
    ]
  })
});
```

Or via WebSocket (lower overhead for high-frequency updates):

```typescript
socket.emit('write', { key: `${quote.source}|${quote.symbol}|bidPrice`, value: quote.bidPrice });
socket.emit('write', { key: `${quote.source}|${quote.symbol}|askPrice`, value: quote.askPrice });
```

---

## 8. Project Structure

```
src/
  main.ts                          # Bootstrap: Swagger, ValidationPipe, IoAdapter, PORT
  app.module.ts                    # ConfigModule.forRoot + StoreModule + AuthModule
  auth/
    api-key.guard.ts               # Optional API key guard
    auth.module.ts                 # AuthModule
    tests/
      api-key.guard.spec.ts        # 6 tests for API key guard
  store/
    data-store.ts                  # Core: DataStore (EventEmitter + Map, deduplication, FIFO)
    store.module.ts                # @Module
    store.service.ts               # @Injectable — wrapper over DataStore
    store.controller.ts            # 12 REST endpoints + Swagger decorators
    store.gateway.ts               # Socket.IO Gateway /store
    interfaces/
      data-point.interface.ts      # { t: number, v: number }
    dto/
      write-point.dto.ts           # { key, value, timestamp? }
      write-batch.dto.ts           # { points: WritePointDto[] }
      query-series.dto.ts          # { from?, to?, limit? }
      keys-query.dto.ts            # { keys[], from?, to?, limit? }
      memory-query.dto.ts          # { keys[] }
    tests/
      data-store.spec.ts           # 26 tests — DataStore core
      store.service.spec.ts        # 16 tests — StoreService
      store.controller.spec.ts     # 12 tests — StoreController
      store.gateway.spec.ts        # 11 tests — StoreGateway

openapi.json                       # OpenAPI 3.0 spec (REST API)
asyncapi.json                      # AsyncAPI 2.6 spec (WebSocket events)
INTEGRATION_GUIDE.md               # This file
```

---

## 9. Key Architectural Decisions

| Decision | Reason |
|---|---|
| In-memory store | Maximum read/write speed with zero I/O |
| Deduplication by value | Memory savings; gaps between points = price stability periods |
| FIFO on maxPoints | OOM protection for long-running processes |
| EventEmitter for subscriptions | Zero polling, instant delivery |
| `__any__` event | Single hook for "subscribe to everything" without key enumeration |
| Socket.IO instead of raw WS | Auto-reconnect, namespaces, ack, cross-platform support |
| Multi-stage Dockerfile | Prod image contains only `dist/` + prod deps, no dev tools |

---

## 10. Adding New Features (for AI Agents)

When extending the project, follow this order:

1. **Add an interface/type** in `src/store/interfaces/` or `src/store/dto/`
2. **Add a method to `DataStore`** (`src/store/data-store.ts`) — pure TypeScript, no DI
3. **Delegate via `StoreService`** (`src/store/store.service.ts`)
4. **Add an endpoint to `StoreController`** or an event to `StoreGateway`
5. **Write the test first** (TDD) in `src/store/tests/*.spec.ts`
6. **Update `openapi.json`** if the REST API changed
7. **Update `asyncapi.json`** if WebSocket events changed
8. **Update this file**

Run all tests:
```bash
npm test
```

Run with coverage:
```bash
npm run test:cov
```

---

## Author

**Razhnou Aliaksei**
