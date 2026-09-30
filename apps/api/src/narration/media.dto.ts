import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  MediaUploadIntentRequest,
  NarrationLocaleCode,
} from '@damsen/shared-types';

import { NARRATION_LOCALE_PATTERN } from './narration.dto.js';

export class MediaUploadIntentDto implements MediaUploadIntentRequest {
  @IsUUID('4')
  poiId!: string;

  @IsString()
  @MaxLength(35)
  @Matches(NARRATION_LOCALE_PATTERN)
  locale!: NarrationLocaleCode;

  @IsIn(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'])
  mimeType!: MediaUploadIntentRequest['mimeType'];

  @IsInt()
  @Min(1)
  @Max(52_428_800)
  sizeBytes!: number;

  @Matches(/^[0-9a-f]{64}$/)
  sha256!: string;
}
