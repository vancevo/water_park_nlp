import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { NarrationLocaleCode } from '@damsen/shared-types';

import { NARRATION_LOCALE_PATTERN } from './narration.dto.js';

/**
 * Body for `POST /v1/admin/narrations/:narrationId/tts-jobs`. Mirrors
 * `CreateTtsJobRequest` (contract v1). Locale shape is checked here; enabled-ness
 * and the match against the narration's own locale are enforced at the service
 * boundary.
 */
export class CreateTtsJobDto {
  @IsString()
  @MaxLength(35)
  @Matches(NARRATION_LOCALE_PATTERN)
  locale!: NarrationLocaleCode;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}
