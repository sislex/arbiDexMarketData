import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PgService } from '../database/pg.service';
import { QuoteInsertRow } from './quote-sync.utils';
import { NumericDataPoint } from './interfaces/data-point.interface';

interface LastTimestampRow {
  key: string;
  last_t: string | number;
}

interface KeyStatsRow {
  key: string;
  records_count: string | number;
  first_t: string | number;
  last_t: string | number;
}

interface RecentQuoteRow {
  key: string;
  t: string | number;
  v: string | number;
}

export interface QuoteKeyStats {
  key: string;
  count: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface QuotesDbKeysStats {
  totalKeys: number;
  keys: QuoteKeyStats[];
}

export type RecentNumericSnapshot = Record<string, NumericDataPoint[]>;

@Injectable()
export class QuotesRepository implements OnModuleInit {
  private readonly logger = new Logger(QuotesRepository.name);

  constructor(private readonly pgService: PgService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.pgService.query(`
        CREATE TABLE IF NOT EXISTS quotes (
          key TEXT NOT NULL,
          t BIGINT NOT NULL,
          v DOUBLE PRECISION NOT NULL,
          inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (key, t)
        )
      `);
      await this.pgService.query('CREATE INDEX IF NOT EXISTS idx_quotes_t ON quotes (t)');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to ensure quotes schema: ${message}`);
    }
  }

  async getRecentSnapshot(limitPerKey: number): Promise<RecentNumericSnapshot> {
    const limit = Number.isFinite(limitPerKey) && limitPerKey > 0
      ? Math.floor(limitPerKey)
      : 5000;

    const result = await this.pgService.query<RecentQuoteRow>(
      `
        WITH ranked AS (
          SELECT
            key,
            t,
            v,
            ROW_NUMBER() OVER (PARTITION BY key ORDER BY t DESC) AS rn
          FROM quotes
        )
        SELECT key, t, v
        FROM ranked
        WHERE rn <= $1
        ORDER BY key ASC, t ASC
      `,
      [limit],
    );

    const snapshot: RecentNumericSnapshot = {};
    for (const row of result.rows) {
      const t = Number(row.t);
      const v = Number(row.v);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;

      if (!snapshot[row.key]) snapshot[row.key] = [];
      snapshot[row.key].push({ t, v });
    }

    return snapshot;
  }

  async getKeysStats(): Promise<QuotesDbKeysStats> {
    const result = await this.pgService.query<KeyStatsRow>(
      `
        SELECT
          key,
          COUNT(*) AS records_count,
          MIN(t) AS first_t,
          MAX(t) AS last_t
        FROM quotes
        GROUP BY key
        ORDER BY key ASC
      `,
    );

    const keys = result.rows.map((row) => ({
      key: row.key,
      count: Number(row.records_count),
      firstTimestamp: Number(row.first_t),
      lastTimestamp: Number(row.last_t),
    }));

    return {
      totalKeys: keys.length,
      keys,
    };
  }

  async getLastTimestamps(keys: string[]): Promise<Map<string, number>> {
    if (keys.length === 0) return new Map();

    const result = await this.pgService.query<LastTimestampRow>(
      `
        SELECT key, MAX(t) AS last_t
        FROM quotes
        WHERE key = ANY($1::text[])
        GROUP BY key
      `,
      [keys],
    );

    const map = new Map<string, number>();
    for (const row of result.rows) {
      const ts = typeof row.last_t === 'string' ? Number(row.last_t) : row.last_t;
      if (Number.isFinite(ts)) {
        map.set(row.key, ts);
      }
    }
    return map;
  }

  async insertBatch(rows: QuoteInsertRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    const values: string[] = [];
    const params: Array<string | number> = [];

    rows.forEach((row, index) => {
      const base = index * 3;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      params.push(row.key, row.t, row.v);
    });

    const result = await this.pgService.query(
      `
        INSERT INTO quotes (key, t, v)
        VALUES ${values.join(', ')}
        ON CONFLICT (key, t) DO NOTHING
      `,
      params,
    );

    return result.rowCount ?? 0;
  }
}


