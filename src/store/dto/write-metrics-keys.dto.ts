import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { METRICS_WINDOWS, MetricsWindowQuery } from './write-metrics-query.dto';

export class WriteMetricsKeysDto {
  @ApiProperty({
    example: ['binance|ETHUSDT|bidPrice', 'mexc|ETHUSDT|askPrice'],
    description: 'Requested keys for grouped metrics',
  })
  @IsArray()
  @IsString({ each: true })
  keys: string[];

  @ApiPropertyOptional({
    example: ['1m', '10m', '1h'],
    description: 'Requested windows for metrics',
    isArray: true,
    enum: METRICS_WINDOWS,
  })
  @IsOptional()
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
}

