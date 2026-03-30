import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class QuerySeriesDto {
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

  @ApiPropertyOptional({ example: 100, description: 'Return last N points' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

