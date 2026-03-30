# arbiDexMarketData

Автономный **NestJS 11** сервис — универсальное in-memory хранилище числовых временных рядов по произвольным строковым ключам.

Является центральным хабом рыночных данных в экосистеме **ArbiDex**:
принимает котировки от `arbiDexServerBots` (и любых других продюсеров) через REST или WebSocket,
хранит историю (до 100 000 точек на ключ, FIFO), раздаёт данные потребителям в реальном времени.

---

## Стек

| Компонент | Технология |
|---|---|
| Фреймворк | NestJS 11 (TypeScript strict) |
| WebSocket | Socket.IO (`@nestjs/platform-socket.io`) |
| Документация REST | `@nestjs/swagger` + Swagger UI |
| Документация WS | AsyncAPI 2.6 (`asyncapi.json`) |
| Конфигурация | `@nestjs/config` + `.env` |
| Тесты | Jest — 61 unit-тест |
| Контейнер | Docker + docker-compose |

---

## Быстрый старт

### Локально

```bash
npm install
cp .env.example .env   # или создайте .env вручную
npm run start:dev
```

### Docker (рекомендуется для production)

```bash
npm run start:docker   # docker compose up --build -d
npm run logs:docker    # docker compose logs -f
npm run stop:docker    # docker compose down
```

Сервис будет доступен на `http://localhost:3001`.

---

## Переменные окружения (`.env`)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3001` | HTTP / WS порт сервера |
| `MAX_POINTS_PER_KEY` | `100000` | Максимум точек на ключ (FIFO) |
| `API_KEY` | _(пусто)_ | API-ключ. Если не задан — аутентификация отключена (dev-режим) |

Сгенерировать безопасный ключ:

```bash
openssl rand -hex 32
```

> ⚠️ Никогда не коммитьте `.env` в репозиторий.

---

## Аутентификация

Если `API_KEY` задан — все запросы требуют ключ:

```bash
# REST — заголовок (рекомендуется)
curl -H "x-api-key: <key>" http://localhost:3001/store/keys

# REST — query-параметр
curl "http://localhost:3001/store/keys?api_key=<key>"
```

```typescript
// WebSocket — auth объект (рекомендуется)
const socket = io('http://localhost:3001/store', { auth: { apiKey: '<key>' } });

// WebSocket — query
const socket = io('http://localhost:3001/store', { query: { api_key: '<key>' } });
```

---

## REST API

**Base URL:** `http://localhost:3001`  
**Swagger UI:** `http://localhost:3001/api`  
**OpenAPI JSON:** `http://localhost:3001/api-json`

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/store/keys` | Все ключи с данными |
| `GET` | `/store/snapshot` | Все ключи → последняя точка |
| `GET` | `/store/key/:key` | Временной ряд (`from`, `to`, `limit`) |
| `GET` | `/store/key/:key/latest` | Последняя точка по ключу |
| `POST` | `/store/keys` | Серии по нескольким ключам сразу |
| `POST` | `/store/write` | Записать одну точку |
| `POST` | `/store/write/batch` | Записать массив точек |
| `DELETE` | `/store/key/:key` | Удалить серию |
| `DELETE` | `/store` | Очистить всё хранилище |
| `GET` | `/store/memory` | Отчёт по памяти — все ключи |
| `GET` | `/store/key/:key/memory` | Память для одного ключа |
| `POST` | `/store/memory/keys` | Память для списка ключей |

Полное описание параметров и ответов — в [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md#5-rest-api).

---

## WebSocket API (Socket.IO)

**Namespace:** `/store`  
**URL:** `ws://localhost:3001/store`  
**AsyncAPI спецификация:** [`asyncapi.json`](./asyncapi.json)

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001/store');

// Подписаться на конкретные ключи
socket.emit('subscribe', { keys: ['binance|ETHUSDT|bidPrice', 'mexc|ETHUSDT|askPrice'] });

// Получать обновления
socket.on('dataChange', ({ key, point }) => {
  console.log(`${key} → ${point.v} @ ${new Date(point.t).toISOString()}`);
});

// Записать точку
socket.emit('write', { key: 'binance|ETHUSDT|bidPrice', value: 3500.5 });

// Отписаться
socket.emit('unsubscribe');
```

Подписка на **все** ключи сразу: `socket.emit('subscribe', {})`.

---

## Формат данных

```typescript
// DataPoint
{ t: number; v: number }  // t — timestamp мс (Unix epoch), v — числовое значение

// Формат ключа (для совместимости с arbiDexServerBots)
"<source>|<symbol>|<field>"
// Примеры:
"binance|ETHUSDT|bidPrice"
"mexc|ETHUSDT|askPrice"
"dex:arbitrum|WETH/USDC|bidPrice"
```

**Дедупликация:** если значение не изменилось — новая точка не записывается.

---

## Тесты

```bash
npm test             # все unit-тесты (61 тест)
npm run test:cov     # с отчётом покрытия
npm run test:e2e     # e2e тесты
```

---

## Структура проекта

```
src/
  main.ts                      # Bootstrap: Swagger, ValidationPipe, IoAdapter, PORT
  app.module.ts                # ConfigModule + StoreModule + AuthModule
  auth/
    api-key.guard.ts           # Опциональная API-key аутентификация
  store/
    data-store.ts              # Ядро: Map + EventEmitter, дедупликация, FIFO
    store.service.ts           # @Injectable — обёртка над DataStore
    store.controller.ts        # REST-эндпоинты + Swagger
    store.gateway.ts           # Socket.IO Gateway /store
    dto/                       # WritePointDto, WriteBatchDto, QuerySeriesDto, ...
    interfaces/                # DataPoint { t, v }
    tests/                     # Unit-тесты

openapi.json                   # OpenAPI 3.0 (REST)
asyncapi.json                  # AsyncAPI 2.6 (WebSocket)
INTEGRATION_GUIDE.md           # Подробная документация для разработчиков и AI-агентов
```

---

## Документация

- **[INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)** — полное руководство для разработчиков и AI-агентов
- **[openapi.json](./openapi.json)** — машиночитаемая спецификация REST API (OpenAPI 3.0)
- **[asyncapi.json](./asyncapi.json)** — машиночитаемая спецификация WebSocket (AsyncAPI 2.6)
- **Swagger UI** — `http://localhost:3001/api` (интерактивная документация, доступна при запущенном сервисе)
