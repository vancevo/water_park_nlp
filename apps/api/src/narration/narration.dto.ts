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
import type { NarrationLocaleCode } from '@damsen/shared-types';

/**
 * Minimal BCP 47 form check shared by narration write/read DTOs. Enabled-ness is
 * enforced against the runtime catalog at the service boundary, not here.
 */
export const NARRATION_LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export class NarrationLocaleQueryDto {
  @IsString()
  @MaxLength(35)
  @Matches(NARRATION_LOCALE_PATTERN)
  locale: NarrationLocaleCode = 'vi';
}

export class NarrationAudioDto {
  @IsString()
  @Matches(
    /^poi\/[0-9a-f-]{36}\/[A-Za-z0-9-]{2,35}\/[0-9a-f]{64}\.(mp3|m4a|ogg|wav)$/,
  )
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
  @IsString()
  @MaxLength(35)
  @Matches(NARRATION_LOCALE_PATTERN)
  locale!: NarrationLocaleCode;

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
