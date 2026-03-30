import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional } from 'class-validator';

export class WritePointDto {
  @ApiProperty({ example: 'binance|ETHUSDT|bidPrice', description: 'Store key' })
  @IsString()
  key: string;

  @ApiProperty({ example: 3500.5, description: 'Numeric value' })
  @IsNumber()
  value: number;

  @ApiPropertyOptional({ example: 1700000000000, description: 'Unix timestamp in ms (defaults to Date.now())' })
  @IsOptional()
  @IsNumber()
  timestamp?: number;
}

