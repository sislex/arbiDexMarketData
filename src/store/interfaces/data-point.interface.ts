export interface NumericDataPoint {
  /** timestamp (ms), Unix epoch */
  t: number;
  /** numeric value */
  v: number;
}

export interface PoolDataPoint {
  /** pool points do not keep timestamp */
  t?: undefined;
  /** pool address value (no timestamp is stored) */
  v: string;
}

export type DataPoint = NumericDataPoint | PoolDataPoint;

