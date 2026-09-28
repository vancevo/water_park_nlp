import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  MediaUploadIntent,
  MediaUploadIntentRequest,
} from '@damsen/shared-types';

import { POI_REPOSITORY, type PoiRepository } from '../poi/poi.models.js';
import { MEDIA_STORAGE, type MediaStorage } from './media-storage.js';

const EXTENSION_BY_MIME: Record<MediaUploadIntentRequest['mimeType'], string> =
  {
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
  };

@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(POI_REPOSITORY) private readonly pois: PoiRepository,
  ) {}

  async createUploadIntent(
    input: MediaUploadIntentRequest,
  ): Promise<MediaUploadIntent> {
    if (!(await this.pois.findForAdmin(input.poiId))) {
      throw new NotFoundException('POI not found');
    }
    const extension = EXTENSION_BY_MIME[input.mimeType];
    const objectKey = `poi/${input.poiId}/${input.locale}/${input.sha256}.${extension}`;
    const signed = await this.storage.signUpload({
      objectKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
    });
    return {
      objectKey,
      uploadUrl: signed.url,
      method: 'PUT',
      expiresAt: signed.expiresAt.toISOString(),
      requiredHeaders: {
        'content-type': input.mimeType,
        'content-length': String(input.sizeBytes),
        'x-amz-checksum-sha256': signed.checksumSha256Base64,
        'x-amz-meta-sha256': input.sha256,
      },
    };
  }
}
