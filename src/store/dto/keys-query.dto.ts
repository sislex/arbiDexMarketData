import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class KeysQueryDto {
  @ApiProperty({ example: ['binance|ETHUSDT|bidPrice', 'mexc|ETHUSDT|askPrice'], description: 'List of keys' })
  @IsArray()
  @IsString({ each: true })
  keys: string[];

  @ApiPropertyOptional({ example: 1700000000000, description: 'Start timestamp (ms, inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  from?: number;

  @ApiPropertyOptional({ example: 1700000099000, description: 'End timestamp (ms, inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  to?: number;

  @ApiPropertyOptional({ example: 100, description: 'Return last N points per key' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

