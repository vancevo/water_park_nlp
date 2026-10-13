import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsIn,
  IsBoolean,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CustomerLookupDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  phone!: string;
}

export class DemoOrderItemDto {
  @IsUUID()
  ticketProductId!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;
}

export class CreateDemoOrderDto {
  @IsString()
  @MinLength(20)
  customerToken!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DemoOrderItemDto)
  items!: DemoOrderItemDto[];

  @IsUUID()
  idempotencyKey!: string;
}

export class ConfirmDemoPaymentDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsOptional()
  @IsIn(['succeeded', 'failed'])
  simulateOutcome: 'succeeded' | 'failed' = 'succeeded';
}

export class CreateRedemptionDto {
  @IsUUID()
  rewardId!: string;

  @IsUUID()
  idempotencyKey!: string;
}

export class LoyaltyAdjustmentDto {
  @IsUUID()
  userId!: string;

  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  delta!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;

  @IsUUID()
  idempotencyKey!: string;
}

export class RecentPaymentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class StartPresenceSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  consentVersion!: string;

  @IsOptional()
  @IsBoolean()
  shareIdentity?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleToVisitors?: boolean;

  @IsOptional()
  @IsIn(['simulated', 'shared'])
  locationMode?: 'simulated' | 'shared';
}

export class PresenceLocationDto {
  @IsUUID()
  sessionId!: string;

  @IsInt()
  @Min(1)
  sequence!: number;

  @IsLatitude()
  @Min(10.757)
  @Max(10.771)
  latitude!: number;

  @IsLongitude()
  @Min(106.6335)
  @Max(106.6435)
  longitude!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  accuracyMeters!: number;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsUUID()
  destinationPoiId?: string;
}
