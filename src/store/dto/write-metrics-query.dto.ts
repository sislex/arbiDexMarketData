import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Min, Max } from 'class-validator';

export const METRICS_WINDOWS = ['1m', '10m', '1h', '12h', '24h'] as const;
export type MetricsWindowQuery = (typeof METRICS_WINDOWS)[number];

function parseWindows(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    return value
      .flatMap((part) => String(part).split(','))
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export class WriteMetricsQueryDto {
  @ApiPropertyOptional({
    example: ['1m', '10m', '1h'],
    description: 'Requested windows. Can be passed as repeated query params or comma-separated string.',
    isArray: true,
    enum: METRICS_WINDOWS,
  })
  @IsOptional()
  @Transform(({ value }) => parseWindows(value))
  @IsArray()
  @IsIn(METRICS_WINDOWS, { each: true })
  windows?: MetricsWindowQuery[];

  @ApiPropertyOptional({
    example: 120,
    description: 'Series range in minutes with 1-minute step. Max 1440.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  seriesMinutes?: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Top keys limit for service metrics. Max 100.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topLimit?: number;
}

