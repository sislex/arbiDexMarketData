import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { WritePointDto } from './write-point.dto';

export class WriteBatchDto {
  @ApiProperty({ type: [WritePointDto], description: 'Array of points to write' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WritePointDto)
  points: WritePointDto[];
}

