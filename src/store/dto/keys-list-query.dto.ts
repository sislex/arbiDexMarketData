import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class KeysListQueryDto {
  @ApiPropertyOptional({
    description: 'Include point count and first/last timestamps per key',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  detail?: boolean;

  @ApiPropertyOptional({
    description: 'Include estimated memory usage (bytes) per key',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  memory?: boolean;
}
