import { DataPoint } from './interfaces/data-point.interface';

export interface QuoteInsertRow {
  key: string;
  t: number;
  v: number;
}

export function isNumericDataPoint(point: DataPoint): point is { t: number; v: number } {
  return (
    typeof point.t === 'number' &&
    Number.isFinite(point.t) &&
    typeof point.v === 'number' &&
    Number.isFinite(point.v)
  );
}

export function buildRowsToPersist(
  seriesByKey: Map<string, DataPoint[]>,
  lastTimestampByKey: Map<string, number>,
): QuoteInsertRow[] {
  const rows: QuoteInsertRow[] = [];

  for (const [key, series] of seriesByKey) {
    const lastTs = lastTimestampByKey.get(key) ?? Number.NEGATIVE_INFINITY;

    for (const point of series) {
      if (!isNumericDataPoint(point)) continue;
      if (point.t <= lastTs) continue;
      rows.push({ key, t: point.t, v: point.v });
    }
  }

  return rows;
}

