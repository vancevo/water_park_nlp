import type {
  NarrationAudioGeneratedBy,
  NarrationAudioMetadataInput,
  NarrationWorkflowStatus,
  NarrationLocaleCode,
} from '@damsen/shared-types';

export interface NarrationRecord {
  id: string;
  poiId: string;
  locale: NarrationLocaleCode;
  revision: number;
  transcript: string;
  status: NarrationWorkflowStatus;
  audio: NarrationAudioMetadataInput | null;
  /**
   * AI provenance of the CURRENT audio (migration 012), written only by the
   * TTS worker when it attaches generated audio to a draft. Cleared when an
   * editor replaces the audio.
   */
  audioGeneratedBy?: NarrationAudioGeneratedBy | null;
  createdBy?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NarrationRepository {
  findPublished(
    poiId: string,
    locale: NarrationLocaleCode,
  ): Promise<NarrationRecord | null>;
  findByPoi(poiId: string): Promise<NarrationRecord[]>;
  findById(id: string): Promise<NarrationRecord | null>;
  nextRevision(poiId: string, locale: NarrationLocaleCode): Promise<number>;
  save(record: NarrationRecord): Promise<void>;
  delete(id: string): Promise<void>;
  publish(id: string, reviewerId: string, reviewedAt: Date): Promise<void>;
}

export const NARRATION_REPOSITORY = Symbol('NARRATION_REPOSITORY');
export const NARRATION_CLOCK = Symbol('NARRATION_CLOCK');
