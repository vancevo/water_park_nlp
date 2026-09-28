import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type {
  AnalyticsEventPayload,
  AnalyticsEventType,
} from '@damsen/shared-types';

import { ANALYTICS_EVENT_TYPES } from './analytics.models.js';

class AnalyticsConsentDto {
  @IsBoolean()
  @Equals(true)
  analytics!: true;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  policyVersion!: string;
}

class AnalyticsEventDto {
  @IsUUID('4')
  eventId!: string;

  @IsIn([1])
  schemaVersion!: 1;

  @IsIn(ANALYTICS_EVENT_TYPES)
  eventType!: AnalyticsEventType;

  @IsISO8601({ strict: true, strictSeparator: true })
  occurredAt!: string;

  @IsObject()
  payload!: AnalyticsEventPayload;
}

export class AnalyticsBatchDto {
  @IsOptional()
  @IsUUID('4')
  anonymousSessionId?: string;

  @ValidateNested()
  @Type(() => AnalyticsConsentDto)
  consent!: AnalyticsConsentDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AnalyticsEventDto)
  events!: AnalyticsEventDto[];
}
