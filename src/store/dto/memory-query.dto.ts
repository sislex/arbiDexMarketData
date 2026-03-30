import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class MemoryQueryDto {
  @ApiProperty({
    example: ['binance|ETHUSDT|bidPrice', 'mexc|ETHUSDT|askPrice'],
    description: 'List of keys to estimate memory usage for',
  })
  @IsArray()
  @IsString({ each: true })
  keys: string[];
}

