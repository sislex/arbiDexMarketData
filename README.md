# arbiDexMarketData

> **Author:** Razhnou Aliaksei

Autonomous **NestJS 11** service — universal in-memory time-series store for numeric market data, keyed by arbitrary strings.

Serves as the **central market data hub** of the ArbiDex ecosystem:
accepts quotes from `arbiDexServerBots` (and any other producers) via REST or WebSocket,
stores history (up to 100 000 points per key, FIFO), and delivers data to consumers in real time.

---

## Stack

| Component | Technology |
|---|---|
| Framework | NestJS 11 (TypeScript strict) |
| WebSocket | Socket.IO (`@nestjs/platform-socket.io`) |
| REST Docs | `@nestjs/swagger` + Swagger UI |
| WS Docs | AsyncAPI 2.6 (`asyncapi.json`) |
| Configuration | `@nestjs/config` + `.env` |
| Tests | Jest — 96 unit tests |
| Container | Docker + docker-compose |

---

## Quick Start

### Local

```bash
npm install
cp .env.example .env   # or create .env manually
npm run start:dev
```

### Docker (recommended for production)

```bash
npm run start:docker   # docker compose up --build -d
npm run logs:docker    # docker compose logs -f
npm run stop:docker    # docker compose down
```

Service will be available at `http://localhost:3002`.

---

## Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | HTTP / WS server port |
| `MAX_POINTS_PER_KEY` | `100000` | Maximum points per key (FIFO ring) |
| `API_KEY` | _(empty)_ | API key. If not set — auth is disabled (dev mode) |

Generate a secure key:

```bash
openssl rand -hex 32
```

> ⚠️ Never commit `.env` to the repository.

---

## Authentication

If `API_KEY` is set — all requests require the key:

```bash
# REST — header (recommended)
curl -H "x-api-key: <key>" http://localhost:3002/store/keys

# REST — query param
curl "http://localhost:3002/store/keys?api_key=<key>"
```

```typescript
// WebSocket — auth object (recommended)
const socket = io('http://localhost:3002/store', { auth: { apiKey: '<key>' } });

// WebSocket — query param
const socket = io('http://localhost:3002/store', { query: { api_key: '<key>' } });
```

---

## REST API

**Base URL:** `http://localhost:3002`  
**Swagger UI:** `http://localhost:3002/api`  
**OpenAPI JSON:** `http://localhost:3002/api-json`

| Method | Path | Description |
|---|---|---|
| `GET` | `/store/keys` | All keys with data |
| `GET` | `/store/snapshot` | All keys → latest point |
| `GET` | `/store/key/:key` | Time series (`from`, `to`, `limit`) |
| `GET` | `/store/key/:key/latest` | Latest point by key |
| `POST` | `/store/keys` | Series for multiple keys at once |
| `POST` | `/store/write` | Write a single point |
| `POST` | `/store/write/batch` | Write an array of points |
| `DELETE` | `/store/key/:key` | Delete series by key |
| `DELETE` | `/store` | Clear the entire store |
| `GET` | `/store/memory` | Memory report — all keys |
| `GET` | `/store/key/:key/memory` | Memory usage for a single key |
| `POST` | `/store/memory/keys` | Memory usage for a list of keys |
| `GET` | `/store/clients` | Connected WebSocket clients and their subscriptions |

Full parameter and response descriptions — [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md#5-rest-api).

---

## WebSocket API (Socket.IO)

**Namespace:** `/store`  
**URL:** `ws://localhost:3002/store`  
**AsyncAPI spec:** [`asyncapi.json`](./asyncapi.json)

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3002/store');

// Subscribe to specific keys
socket.emit('subscribe', { keys: ['binance|ETHUSDT|bidPrice', 'mexc|ETHUSDT|askPrice'] });

// Receive updates
socket.on('dataChange', ({ key, point }) => {
  console.log(`${key} → ${point.v} @ ${new Date(point.t).toISOString()}`);
});

// Write a point
socket.emit('write', { key: 'binance|ETHUSDT|bidPrice', value: 3500.5 });

// Unsubscribe
socket.emit('unsubscribe');
```

Subscribe to **all** keys at once: `socket.emit('subscribe', {})`.

---

## Data Format

```typescript
// DataPoint
{ t: number; v: number }  // t — timestamp mс (Unix epoch), v — numeric value

// Key format (compatible with arbiDexServerBots)
"<source>|<symbol>|<field>"
// Examples:
"binance|ETHUSDT|bidPrice"
"mexc|ETHUSDT|askPrice"
"dex:arbitrum|WETH/USDC|bidPrice"
```

**Deduplication:** if the value has not changed, no new point is stored.

---

## Tests

```bash
npm test             # all unit tests (61 tests)
npm run test:cov     # with coverage report
npm run test:e2e     # e2e tests
```

---

## Project Structure

```
src/
  main.ts                      # Bootstrap: Swagger, ValidationPipe, IoAdapter, PORT
  app.module.ts                # ConfigModule + StoreModule + AuthModule
  auth/
    api-key.guard.ts           # Optional API-key authentication
  store/
    data-store.ts              # Core: Map + EventEmitter, deduplication, FIFO
    store.service.ts           # @Injectable — wrapper over DataStore
    store.controller.ts        # REST endpoints + Swagger decorators
    store.gateway.ts           # Socket.IO Gateway /store
    dto/                       # WritePointDto, WriteBatchDto, QuerySeriesDto, ...
    interfaces/                # DataPoint { t, v }
    tests/                     # Unit tests

openapi.json                   # OpenAPI 3.0 (REST)
asyncapi.json                  # AsyncAPI 2.6 (WebSocket)
INTEGRATION_GUIDE.md           # Full guide for developers and AI agents
```

---

## Documentation

- **[INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)** — full guide for developers and AI agents
- **[openapi.json](./openapi.json)** — machine-readable REST API spec (OpenAPI 3.0)
- **[asyncapi.json](./asyncapi.json)** — machine-readable WebSocket spec (AsyncAPI 2.6)
- **Swagger UI** — `http://localhost:3002/api` (interactive docs, available when the service is running)

---

## Author

**Razhnou Aliaksei**
