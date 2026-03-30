# 🤖 Integration Guide — arbiDexMarketData

> **Автор:** Razhnou Aliaksei  
> Документ предназначен для AI-агентов и разработчиков, которые хотят программно
> взаимодействовать с сервисом рыночных данных **arbiDexMarketData**.

---

## 1. Обзор проекта

**arbiDexMarketData** — автономный NestJS 11 (TypeScript) сервис,
который предоставляет универсальное **in-memory хранилище числовых временных рядов**
по произвольным строковым ключам.

### Назначение

Сервис является **центральным хабом рыночных данных** для экосистемы ArbiDex:

- Принимает котировки от **arbiDexServerBots** (и любых других продюсеров) через REST или WebSocket
- Хранит историю цен (до 100 000 точек на ключ, FIFO)
- Раздаёт данные потребителям — торговым ботам, дашбордам, аналитическим агентам
- Поддерживает **real-time подписки** через Socket.IO

### Стек

| Компонент | Технология |
|---|---|
| Фреймворк | NestJS 11 |
| Язык | TypeScript (strict) |
| WebSocket | Socket.IO (`@nestjs/platform-socket.io`) |
| Документация | `@nestjs/swagger` + Swagger UI |
| Конфигурация | `@nestjs/config` + `.env` |
| Тесты | Jest (unit, 61 тест) |
| Контейнер | Docker + docker-compose |

---

## 2. Запуск

```bash
# Установка зависимостей
npm install

# Режим разработки (watch)
npm run start:dev

# Production-сборка
npm run build && npm run start:prod

# Docker (рекомендуется для production)
npm run start:docker    # docker compose up --build -d
npm run stop:docker     # docker compose down
npm run logs:docker     # docker compose logs -f

# Тесты
npm test
npm run test:cov        # с покрытием
```

### Переменные окружения (`.env`)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3002` | HTTP/WS порт сервера |
| `MAX_POINTS_PER_KEY` | `100000` | Максимум точек на ключ (FIFO-кольцо) |
| `API_KEY` | _(пусто)_ | API-ключ. Если не задан — аутентификация отключена (dev-режим) |

---

## 3. Аутентификация (API Key)

Сервис поддерживает опциональную аутентификацию по API ключу.

### Включение

В `.env` раскомментируйте и установите переменную:

```bash
# Сгенерировать безопасный ключ:
openssl rand -hex 32

# Записать в .env:
API_KEY=ваш-секретный-ключ
```

Если `API_KEY` **не задан** (или пустая строка) — аутентификация **отключена** (dev-режим, любые запросы проходят).

### REST API

Передавайте ключ одним из двух способов (приоритет: заголовок > query):

```bash
# Заголовок (рекомендуется)
curl -H "x-api-key: ваш-секретный-ключ" http://localhost:3002/store/keys

# Query-параметр
curl "http://localhost:3002/store/keys?api_key=ваш-секретный-ключ"
```

При неверном или отсутствующем ключе — `401 Unauthorized`.

### WebSocket (Socket.IO)

Передавайте ключ в handshake:

```typescript
// auth объект (рекомендуется)
const socket = io('http://localhost:3002/store', {
  auth: { apiKey: 'ваш-секретный-ключ' }
});

// или query-параметр
const socket = io('http://localhost:3002/store', {
  query: { api_key: 'ваш-секретный-ключ' }
});
```

При неверном ключе сервер отправит `error { message: 'Invalid or missing API key' }` и разорвёт соединение.

### Swagger UI

При включённой аутентификации нажмите кнопку **Authorize** в Swagger UI (`http://localhost:3002/api`) и введите API ключ в поле `x-api-key`.

---

## 4. Формат данных

### DataPoint

```typescript
interface DataPoint {
  t: number;  // timestamp (мс), Unix epoch — Date.now()
  v: number;  // числовое значение
}
```

### Ключ

Ключ — произвольная строка. Для совместимости с **arbiDexServerBots** используется формат:

```
<source>|<symbol>|<field>
```

Примеры:
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

### Дедупликация

Если записываемое значение **не изменилось** относительно последней точки — новая точка **не записывается**.
Это позволяет точно определять периоды, когда цена была неизменна.

---

## 5. REST API

**Base URL:** `http://localhost:3002`  
**OpenAPI JSON:** `http://localhost:3002/api-json`  
**Swagger UI:** `http://localhost:3002/api`

### 5.1 Чтение данных

#### `GET /store/keys`
Список всех ключей с данными.

```bash
curl http://localhost:3002/store/keys
# → ["binance|ETHUSDT|bidPrice", "mexc|ETHUSDT|askPrice", ...]
```

---

#### `GET /store/snapshot`
Снапшот: все ключи с их **последней** точкой.

```bash
curl http://localhost:3002/store/snapshot
# → { "binance|ETHUSDT|bidPrice": { "t": 1700000001000, "v": 3500.5 }, ... }
```

---

#### `GET /store/key/:key`
Временной ряд по ключу. Поддерживает фильтрацию:

| Query-параметр | Тип | Описание |
|---|---|---|
| `from` | number (мс) | Начало диапазона (включительно) |
| `to` | number (мс) | Конец диапазона (включительно) |
| `limit` | integer ≥ 1 | Вернуть последние N точек |

```bash
# Все точки
curl "http://localhost:3002/store/key/binance%7CETHUSDT%7CbidPrice"

# Последние 50 точек
curl "http://localhost:3002/store/key/binance%7CETHUSDT%7CbidPrice?limit=50"

# Диапазон по времени
curl "http://localhost:3002/store/key/binance%7CETHUSDT%7CbidPrice?from=1700000000000&to=1700000099000"
```

**Ответ:**
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
Только последняя точка по ключу. Возвращает `404` если ключа нет.

```bash
curl "http://localhost:3002/store/key/binance%7CETHUSDT%7CbidPrice/latest"
# → { "t": 1700000002000, "v": 3501.0 }
```

---

#### `POST /store/keys`
Серии сразу по нескольким ключам (+ опциональная фильтрация).

```bash
curl -X POST http://localhost:3002/store/keys \
  -H 'Content-Type: application/json' \
  -d '{
    "keys": ["binance|ETHUSDT|bidPrice", "mexc|ETHUSDT|askPrice"],
    "limit": 10
  }'
```

**Ответ:**
```json
{
  "binance|ETHUSDT|bidPrice": { "points": [...], "count": 10, "last": { "t": ..., "v": ... } },
  "mexc|ETHUSDT|askPrice":    { "points": [...], "count": 10, "last": { "t": ..., "v": ... } }
}
```

---

### 5.2 Запись данных

#### `POST /store/write`
Записать одну точку.

```bash
curl -X POST http://localhost:3002/store/write \
  -H 'Content-Type: application/json' \
  -d '{ "key": "binance|ETHUSDT|bidPrice", "value": 3500.5 }'

# С явным timestamp
curl -X POST http://localhost:3002/store/write \
  -H 'Content-Type: application/json' \
  -d '{ "key": "binance|ETHUSDT|bidPrice", "value": 3500.5, "timestamp": 1700000001000 }'
```

**Ответ:** `201 { "success": true }`

---

#### `POST /store/write/batch`
Записать массив точек за один запрос (эффективнее для batch-продюсеров).

```bash
curl -X POST http://localhost:3002/store/write/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "points": [
      { "key": "binance|ETHUSDT|bidPrice", "value": 3500.5 },
      { "key": "binance|ETHUSDT|askPrice", "value": 3501.0 },
      { "key": "mexc|ETHUSDT|bidPrice",    "value": 3499.8 }
    ]
  }'
```

**Ответ:** `201 { "written": 3 }`

---

### 5.3 Удаление данных

#### `DELETE /store/key/:key`
Удалить серию по ключу.

```bash
curl -X DELETE "http://localhost:3002/store/key/binance%7CETHUSDT%7CbidPrice"
# → { "deleted": true }
```

#### `DELETE /store`
Очистить **всё** хранилище.

```bash
curl -X DELETE http://localhost:3002/store
# → { "cleared": true }
```

---

### 5.4 Оценка потребления памяти

Сервис хранит данные в памяти процесса. Эти эндпоинты позволяют отслеживать, сколько
памяти занимают ключи. Размер вычисляется как JSON-сериализованная длина строки ключа +
массива точек — детерминированно и одинаково на всех платформах.

#### `GET /store/memory`
Отчёт по **всем** ключам.

```bash
curl http://localhost:3002/store/memory
```

**Ответ:**
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
Память для **одного** ключа. Возвращает `404` если ключ не существует.

```bash
curl "http://localhost:3002/store/key/binance%7CETHUSDT%7CbidPrice/memory"
# → { "key": "binance|ETHUSDT|bidPrice", "points": 1024, "bytes": 28672, "bytesHuman": "28.00 KB" }
```

---

#### `POST /store/memory/keys`
Память для **списка** ключей. Несуществующие ключи молча пропускаются.

```bash
curl -X POST http://localhost:3002/store/memory/keys \
  -H 'Content-Type: application/json' \
  -d '{ "keys": ["binance|ETHUSDT|bidPrice", "mexc|ETHUSDT|askPrice"] }'
```

**Ответ:** та же структура `MemoryUsageReport`, что и `GET /store/memory`.

---

## 6. WebSocket API (Socket.IO)

**Namespace:** `/store`  
**URL:** `ws://localhost:3002/store`

> **Машиночитаемый контракт:** [`asyncapi.json`](./asyncapi.json) — AsyncAPI 2.6 спецификация всех событий, схем и примеров.

### 6.1 Подключение (socket.io-client)

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3002/store');

socket.on('connect', () => console.log('Connected:', socket.id));
```

### 6.2 Подписка на конкретные ключи

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

### 6.3 Подписка на ВСЕ ключи

```typescript
socket.emit('subscribe', {});       // пустой объект
// или
socket.emit('subscribe', { keys: [] }); // пустой массив

socket.on('subscribed', (info) => {
  console.log(info.keys); // 'all'
});
```

### 6.4 Запись через WebSocket

```typescript
socket.emit('write', {
  key: 'binance|ETHUSDT|bidPrice',
  value: 3500.5,
  timestamp: Date.now(), // опционально
});
```

### 6.5 Отписка

```typescript
socket.emit('unsubscribe');
socket.on('unsubscribed', () => console.log('Unsubscribed'));
```

### 6.6 Таблица событий

| Направление | Событие | Payload | Описание |
|---|---|---|---|
| Клиент → Сервер | `subscribe` | `{ keys?: string[] }` | Подписка. Без `keys` — подписка на всё |
| Клиент → Сервер | `unsubscribe` | — | Отписка |
| Клиент → Сервер | `write` | `{ key, value, timestamp? }` | Запись точки |
| Сервер → Клиент | `subscribed` | `{ keys: string[] \| 'all' }` | Подтверждение подписки |
| Сервер → Клиент | `unsubscribed` | `{}` | Подтверждение отписки |
| Сервер → Клиент | `dataChange` | `{ key: string, point: DataPoint }` | Новое значение |

### 6.7 Подключение без socket.io-client (raw Engine.IO)

```
1. GET  http://localhost:3002/store/socket.io/?EIO=4&transport=polling  → получить sid
2. WS   ws://localhost:3002/store/socket.io/?EIO=4&transport=websocket&sid=<sid>
3. → отправить: 40
4. ← получить: 40{"sid":"..."}
5. → отправить subscribe: 42["subscribe",{"keys":["binance|ETHUSDT|bidPrice"]}]
6. ← получить: 42["dataChange",{"key":"binance|ETHUSDT|bidPrice","point":{"t":...,"v":...}}]
```

---

## 7. Интеграция с arbiDexServerBots

**arbiDexServerBots** собирает котировки и складывает их в свой внутренний `PriceStore`.
Чтобы продублировать данные в **arbiDexMarketData**, нужно добавить вызов после записи в `PriceStore`:

```typescript
// В джобе после получения котировки:
priceStore.recordQuote(quote);

// Дополнительно — отправить в arbiDexMarketData:
await fetch('http://localhost:3002/store/write/batch', {
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

Или через WebSocket (меньше overhead при высокочастотных обновлениях):

```typescript
socket.emit('write', { key: `${quote.source}|${quote.symbol}|bidPrice`, value: quote.bidPrice });
socket.emit('write', { key: `${quote.source}|${quote.symbol}|askPrice`, value: quote.askPrice });
```

---

## 8. Структура проекта

```
src/
  main.ts                          # Bootstrap: Swagger, ValidationPipe, IoAdapter, PORT
  app.module.ts                    # ConfigModule.forRoot + StoreModule + AuthModule
  auth/
    api-key.guard.ts               # Опциональная API-key аутентификация
    auth.module.ts                 # AuthModule
    tests/
      api-key.guard.spec.ts        # 6 тестов API key guard
  store/
    data-store.ts                  # Ядро: DataStore (EventEmitter + Map, дедупликация, FIFO)
    store.module.ts                # @Module
    store.service.ts               # @Injectable — обёртка над DataStore
    store.controller.ts            # 12 REST-эндпоинтов + Swagger декораторы
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
      data-store.spec.ts           # 26 тестов ядра DataStore
      store.service.spec.ts        # 16 тестов StoreService
      store.controller.spec.ts     # 12 тестов StoreController
      store.gateway.spec.ts        # 11 тестов StoreGateway

openapi.json                       # OpenAPI 3.0 spec (REST API)
asyncapi.json                      # AsyncAPI 2.6 spec (WebSocket events)
INTEGRATION_GUIDE.md               # Английская версия этого документа
```

---

## 9. Ключевые архитектурные решения

| Решение | Причина |
|---|---|
| In-memory хранилище | Максимальная скорость read/write без I/O |
| Дедупликация по value | Экономия памяти; интервалы между точками = время неизменности цены |
| FIFO при достижении maxPoints | Защита от OOM при длительной работе |
| EventEmitter для подписок | Нулевой polling, мгновенная доставка |
| `__any__` event | Единственная точка для "подписаться на всё" без перебора ключей |
| Socket.IO вместо raw WS | Автоматический reconnect, namespace, ack, поддержка всех платформ |
| Многоступенчатый Dockerfile | Prod-образ содержит только `dist/` + prod-deps, без dev-tools |

---

## 10. Добавление новых возможностей (для AI-агентов)

При расширении проекта следуй этому порядку:

1. **Добавь интерфейс/тип** в `src/store/interfaces/` или `src/store/dto/`
2. **Добавь метод в `DataStore`** (`src/store/data-store.ts`) — чистый TypeScript, без DI
3. **Делегируй через `StoreService`** (`src/store/store.service.ts`)
4. **Добавь эндпоинт в `StoreController`** или событие в `StoreGateway`
5. **Напиши тест первым** (TDD) в `src/store/tests/*.spec.ts`
6. **Обнови `openapi.json`** если изменился REST API
7. **Обнови `asyncapi.json`** если изменились WebSocket-события
8. **Обнови этот файл**

Все тесты запускаются командой:
```bash
npm test
```

Покрытие:
```bash
npm run test:cov
```

---

## Автор

**Razhnou Aliaksei**
