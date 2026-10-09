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
  NarrationAudioPlayback,
  NarrationLocaleCode,
  PoiNarration,
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
import { NarrationLocalesService } from './narration-locales.service.js';
import { TTS_JOB_REPOSITORY, type TtsJobRepository } from './tts-job.models.js';
import { TtsJobInProgressException } from './tts-job-controls.js';

@Injectable()
export class NarrationService {
  constructor(
    @Inject(NARRATION_REPOSITORY)
    private readonly narrations: NarrationRepository,
    @Inject(POI_REPOSITORY) private readonly pois: PoiRepository,
    @Inject(NARRATION_CLOCK) private readonly now: () => Date,
    @Inject(MEDIA_STORAGE) private readonly mediaStorage: MediaStorage,
    @Inject(NarrationLocalesService)
    private readonly locales: NarrationLocalesService,
    @Inject(TTS_JOB_REPOSITORY) private readonly ttsJobs: TtsJobRepository,
  ) {}

  async published(
    poiId: string,
    locale: NarrationLocaleCode,
  ): Promise<PoiNarration> {
    if (!(await this.pois.findPublishedById(poiId))) {
      throw new NotFoundException('POI not found');
    }
    const { requested, chain } = this.locales.resolveRequest(locale);
    let narration: NarrationRecord | null = null;
    let resolvedLocale: NarrationLocaleCode | null = null;
    for (const candidate of chain) {
      const found = await this.narrations.findPublished(poiId, candidate);
      if (found) {
        narration = found;
        resolvedLocale = candidate;
        break;
      }
    }
    if (!narration || resolvedLocale === null) {
      throw new NotFoundException('Published narration not found');
    }
    const playback = narration.audio
      ? await this.mediaStorage.signPlayback(narration.audio.objectKey)
      : null;
    return {
      id: narration.id,
      poiId,
      requestedLocale: requested,
      resolvedLocale,
      fallbackUsed: resolvedLocale !== requested,
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
    const locale = this.locales.requireEnabled(input.locale);
    const existing = await this.narrations.findByPoi(poiId);
    if (
      existing.some(
        (item) =>
          item.locale === locale &&
          ['draft', 'pending_review'].includes(item.status),
      )
    ) {
      throw new ConflictException(
        'An editable or pending narration already exists for this locale',
      );
    }
    this.assertObjectKey(poiId, locale, input.audio ?? null);
    const at = this.now();
    const record: NarrationRecord = {
      id: randomUUID(),
      poiId,
      locale,
      revision: await this.narrations.nextRevision(poiId, locale),
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
    // The worker may attach generated audio while a job runs; edits wait so
    // neither side overwrites the other (I02-6, ADR 0014).
    await this.assertNoActiveTtsJob(id);
    const audio = input.audio === undefined ? record.audio : input.audio;
    this.assertObjectKey(record.poiId, record.locale, audio ?? null);
    const sameAudio =
      audio !== null &&
      audio !== undefined &&
      record.audio !== null &&
      audio.objectKey === record.audio.objectKey &&
      audio.sha256 === record.audio.sha256;
    const updated: NarrationRecord = {
      ...record,
      transcript: input.transcript?.trim() ?? record.transcript,
      audio: audio ? { ...audio } : null,
      // Provenance describes the current audio only; replaced audio drops it.
      audioGeneratedBy: sameAudio ? (record.audioGeneratedBy ?? null) : null,
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
    // Server-side review gate (I02-6): never submit while a TTS job could
    // still attach audio to this draft.
    await this.assertNoActiveTtsJob(id);
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

  /** Ten-minute signed GET so an admin can preview the current (draft) audio. */
  async audioPlayback(id: string): Promise<NarrationAudioPlayback> {
    const record = await this.required(id);
    if (!record.audio) {
      throw new NotFoundException({
        code: 'NARRATION_AUDIO_NOT_FOUND',
        message: 'Narration has no audio',
        details: null,
      });
    }
    const playback = await this.mediaStorage.signPlayback(
      record.audio.objectKey,
    );
    return {
      playbackUrl: playback.url,
      playbackExpiresAt: playback.expiresAt.toISOString(),
    };
  }

  private async assertNoActiveTtsJob(narrationId: string): Promise<void> {
    if (await this.ttsJobs.hasActiveForNarration(narrationId)) {
      throw new TtsJobInProgressException();
    }
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
    locale: NarrationLocaleCode,
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
      ...(record.audio && record.audioGeneratedBy
        ? { audioGeneratedBy: { ...record.audioGeneratedBy } }
        : {}),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
