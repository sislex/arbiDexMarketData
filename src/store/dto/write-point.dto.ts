import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDefined,
  IsNumber,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { PoolMetadata, isPoolMetadata } from '../interfaces/data-point.interface';

function IsNumberOrPoolMetadata(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isNumberOrPoolMetadata',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (typeof value === 'number' && Number.isFinite(value)) || isPoolMetadata(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a finite number or pool metadata object { dex, version, poolAddress }`;
        },
      },
    });
  };
}

export class WritePointDto {
  @ApiProperty({ example: 'binance|ETHUSDT|bidPrice', description: 'Store key' })
  @IsString()
  key: string;

  @ApiProperty({
    description: 'Value: number for price keys, object { dex, version, poolAddress } for pool keys (|bidPool / |askPool)',
    oneOf: [
      { type: 'number', example: 3500.5 },
      {
        type: 'object',
        properties: {
          dex: { type: 'string', example: 'sushi' },
          version: { type: 'string', example: 'v3' },
          poolAddress: { type: 'string', example: '0xf3eb87c1f6020982173c908e7eb31aa66c1f0296' },
        },
        required: ['dex', 'version', 'poolAddress'],
      },
    ],
  })
  @IsDefined()
  @IsNumberOrPoolMetadata()
  value: number | PoolMetadata;

  @ApiPropertyOptional({ example: 1700000000000, description: 'Unix timestamp in ms (defaults to Date.now())' })
  @IsOptional()
  @IsNumber()
  timestamp?: number;
}

