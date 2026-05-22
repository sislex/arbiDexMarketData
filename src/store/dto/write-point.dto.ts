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

function IsNumberOrString(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isNumberOrString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'number' || typeof value === 'string';
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a number or a string`;
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
    description: 'Value: number for price keys, string for pool keys (|bidPool / |askPool)',
    oneOf: [
      { type: 'number', example: 3500.5 },
      { type: 'string', example: '0x1234567890abcdef1234567890abcdef12345678' },
    ],
  })
  @IsDefined()
  @IsNumberOrString()
  value: number | string;

  @ApiPropertyOptional({ example: 1700000000000, description: 'Unix timestamp in ms (defaults to Date.now())' })
  @IsOptional()
  @IsNumber()
  timestamp?: number;
}

