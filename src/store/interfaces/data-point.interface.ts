export interface NumericDataPoint {
  /** timestamp (ms), Unix epoch */
  t: number;
  /** numeric value */
  v: number;
}

export interface PoolMetadata {
  dex: string;
  version: string;
  poolAddress: string;
}

export interface PoolDataPoint {
  /** pool points do not keep timestamp */
  t?: undefined;
  /** pool metadata (no timestamp is stored) */
  v: PoolMetadata;
}

export type DataPoint = NumericDataPoint | PoolDataPoint;

export function isPoolMetadata(value: unknown): value is PoolMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.dex === 'string' &&
    candidate.dex.length > 0 &&
    typeof candidate.version === 'string' &&
    candidate.version.length > 0 &&
    typeof candidate.poolAddress === 'string' &&
    candidate.poolAddress.length > 0
  );
}

