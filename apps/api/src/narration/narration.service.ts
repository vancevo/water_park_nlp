import { randomUUID } from 'node:crypto';

import { MEDIA_STORAGE, type MediaStorage } from './media-storage.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminNarration,
  PoiNarration,
  SupportedLocale,
} from '@damsen/shared-types';

import { POI_REPOSITORY, type PoiRepository } from '../poi/poi.models.js';
import type {
  CreateNarrationDto,
  UpdateNarrationDto,
} from './narration.dto.js';
import {
  NARRATION_CLOCK,
  NARRATION_REPOSITORY,
  type NarrationRecord,
  type NarrationRepository,
} from './narration.models.js';

@Injectable()
export class NarrationService {
  constructor(
    @Inject(NARRATION_REPOSITORY)
    private readonly narrations: NarrationRepository,
    @Inject(POI_REPOSITORY) private readonly pois: PoiRepository,
    @Inject(NARRATION_CLOCK) private readonly now: () => Date,
    @Inject(MEDIA_STORAGE) private readonly mediaStorage: MediaStorage,
  ) {}

  async published(
    poiId: string,
    locale: SupportedLocale,
  ): Promise<PoiNarration> {
    if (!(await this.pois.findPublishedById(poiId))) {
      throw new NotFoundException('POI not found');
    }
    const narration = await this.narrations.findPublished(poiId, locale);
    if (!narration)
      throw new NotFoundException('Published narration not found');
    const playback = narration.audio
      ? await this.mediaStorage.signPlayback(narration.audio.objectKey)
      : null;
    return {
      id: narration.id,
      poiId,
      requestedLocale: locale,
      resolvedLocale: locale,
      fallbackUsed: false,
      transcript: narration.transcript,
      audio: narration.audio
        ? {
            mimeType: narration.audio.mimeType,
            sizeBytes: narration.audio.sizeBytes,
            sha256: narration.audio.sha256,
            durationSeconds: narration.audio.durationSeconds,
            rightsOwner: narration.audio.rightsOwner,
            rightsSource: narration.audio.rightsSource,
            usageRights: narration.audio.usageRights,
            playbackUrl: playback!.url,
            playbackExpiresAt: playback!.expiresAt.toISOString(),
          }
        : null,
    };
  }

  async list(poiId: string): Promise<AdminNarration[]> {
    await this.requireAdminPoi(poiId);
    return (await this.narrations.findByPoi(poiId)).map((item) =>
      this.toAdmin(item),
    );
  }

  async create(
    poiId: string,
    input: CreateNarrationDto,
    actorId: string,
  ): Promise<AdminNarration> {
    await this.requireAdminPoi(poiId);
    const existing = await this.narrations.findByPoi(poiId);
    if (
      existing.some(
        (item) =>
          item.locale === input.locale &&
          ['draft', 'pending_review'].includes(item.status),
      )
    ) {
      throw new ConflictException(
        'An editable or pending narration already exists for this locale',
      );
    }
    this.assertObjectKey(poiId, input.locale, input.audio ?? null);
    const at = this.now();
    const record: NarrationRecord = {
      id: randomUUID(),
      poiId,
      locale: input.locale,
      revision: await this.narrations.nextRevision(poiId, input.locale),
      transcript: input.transcript.trim(),
      status: 'draft',
      audio: input.audio ? { ...input.audio } : null,
      createdBy: actorId,
      createdAt: at,
      updatedAt: at,
    };
    await this.narrations.save(record);
    return this.toAdmin(record);
  }

  async update(id: string, input: UpdateNarrationDto): Promise<AdminNarration> {
    const record = await this.required(id);
    if (!['draft', 'rejected'].includes(record.status)) {
      throw new ConflictException(
        'Only draft or rejected narration can be edited',
      );
    }
    const audio = input.audio === undefined ? record.audio : input.audio;
    this.assertObjectKey(record.poiId, record.locale, audio ?? null);
    const updated: NarrationRecord = {
      ...record,
      transcript: input.transcript?.trim() ?? record.transcript,
      audio: audio ? { ...audio } : null,
      status: 'draft',
      rejectionReason: undefined,
      updatedAt: this.now(),
    };
    await this.narrations.save(updated);
    return this.toAdmin(updated);
  }

  async remove(id: string): Promise<void> {
    const record = await this.required(id);
    if (!['draft', 'rejected'].includes(record.status)) {
      throw new ConflictException(
        'Only draft or rejected narration can be deleted',
      );
    }
    await this.narrations.delete(id);
  }

  async submit(id: string): Promise<AdminNarration> {
    const record = await this.required(id);
    if (!['draft', 'rejected'].includes(record.status)) {
      throw new ConflictException('Narration is not editable');
    }
    if (record.transcript.trim().length < 20) {
      throw new BadRequestException('A reviewed transcript is required');
    }
    if (record.audio) await this.mediaStorage.verifyAudioObject(record.audio);
    record.status = 'pending_review';
    record.rejectionReason = undefined;
    record.updatedAt = this.now();
    await this.narrations.save(record);
    return this.toAdmin(record);
  }

  async approve(id: string, actorId: string): Promise<AdminNarration> {
    const record = await this.required(id);
    if (record.status !== 'pending_review') {
      throw new ConflictException('Narration is not pending review');
    }
    await this.narrations.publish(id, actorId, this.now());
    return this.toAdmin(await this.required(id));
  }

  async reject(
    id: string,
    reason: string,
    actorId: string,
  ): Promise<AdminNarration> {
    const record = await this.required(id);
    if (record.status !== 'pending_review') {
      throw new ConflictException('Narration is not pending review');
    }
    record.status = 'rejected';
    record.reviewedBy = actorId;
    record.rejectionReason = reason.trim();
    record.updatedAt = this.now();
    await this.narrations.save(record);
    return this.toAdmin(record);
  }

  private async requireAdminPoi(id: string): Promise<void> {
    if (!(await this.pois.findForAdmin(id)))
      throw new NotFoundException('POI not found');
  }

  private async required(id: string): Promise<NarrationRecord> {
    const record = await this.narrations.findById(id);
    if (!record) throw new NotFoundException('Narration not found');
    return record;
  }

  private assertObjectKey(
    poiId: string,
    locale: SupportedLocale,
    audio: NarrationRecord['audio'],
  ): void {
    if (!audio) return;
    const expectedPrefix = `poi/${poiId}/${locale}/${audio.sha256}.`;
    if (!audio.objectKey.startsWith(expectedPrefix)) {
      throw new BadRequestException(
        'Audio object key must match its POI, locale and SHA-256',
      );
    }
  }

  private toAdmin(record: NarrationRecord): AdminNarration {
    return {
      id: record.id,
      poiId: record.poiId,
      locale: record.locale,
      revision: record.revision,
      transcript: record.transcript,
      status: record.status,
      audio: record.audio ? { ...record.audio } : null,
      ...(record.rejectionReason
        ? { rejectionReason: record.rejectionReason }
        : {}),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
