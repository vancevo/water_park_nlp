import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { SupportedLocale } from '@damsen/shared-types';

export class NarrationLocaleQueryDto {
  @IsIn(['vi', 'en'])
  locale: SupportedLocale = 'vi';
}

export class NarrationAudioDto {
  @IsString()
  @Matches(/^poi\/[0-9a-f-]{36}\/(vi|en)\/[0-9a-f]{64}\.(mp3|m4a|ogg|wav)$/)
  objectKey!: string;

  @IsIn(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'])
  mimeType!: 'audio/mpeg' | 'audio/mp4' | 'audio/ogg' | 'audio/wav';

  @IsInt()
  @Min(1)
  @Max(52_428_800)
  sizeBytes!: number;

  @Matches(/^[0-9a-f]{64}$/)
  sha256!: string;

  @IsNumber()
  @Min(0.001)
  @Max(1800)
  durationSeconds!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  rightsOwner!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  rightsSource!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  usageRights!: string;
}

export class CreateNarrationDto {
  @IsIn(['vi', 'en'])
  locale!: SupportedLocale;

  @IsString()
  @MinLength(20)
  @MaxLength(20_000)
  transcript!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NarrationAudioDto)
  audio?: NarrationAudioDto | null;
}

export class UpdateNarrationDto {
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(20_000)
  transcript?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NarrationAudioDto)
  audio?: NarrationAudioDto | null;
}

export class RejectNarrationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
