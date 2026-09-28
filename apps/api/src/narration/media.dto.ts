import { IsIn, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';
import type {
  MediaUploadIntentRequest,
  SupportedLocale,
} from '@damsen/shared-types';

export class MediaUploadIntentDto implements MediaUploadIntentRequest {
  @IsUUID('4')
  poiId!: string;

  @IsIn(['vi', 'en'])
  locale!: SupportedLocale;

  @IsIn(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'])
  mimeType!: MediaUploadIntentRequest['mimeType'];

  @IsInt()
  @Min(1)
  @Max(52_428_800)
  sizeBytes!: number;

  @Matches(/^[0-9a-f]{64}$/)
  sha256!: string;
}
