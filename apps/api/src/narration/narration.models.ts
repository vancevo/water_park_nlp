import type {
  NarrationAudioMetadataInput,
  NarrationWorkflowStatus,
  SupportedLocale,
} from '@damsen/shared-types';

export interface NarrationRecord {
  id: string;
  poiId: string;
  locale: SupportedLocale;
  revision: number;
  transcript: string;
  status: NarrationWorkflowStatus;
  audio: NarrationAudioMetadataInput | null;
  createdBy?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NarrationRepository {
  findPublished(
    poiId: string,
    locale: SupportedLocale,
  ): Promise<NarrationRecord | null>;
  findByPoi(poiId: string): Promise<NarrationRecord[]>;
  findById(id: string): Promise<NarrationRecord | null>;
  nextRevision(poiId: string, locale: SupportedLocale): Promise<number>;
  save(record: NarrationRecord): Promise<void>;
  delete(id: string): Promise<void>;
  publish(id: string, reviewerId: string, reviewedAt: Date): Promise<void>;
}

export const NARRATION_REPOSITORY = Symbol('NARRATION_REPOSITORY');
export const NARRATION_CLOCK = Symbol('NARRATION_CLOCK');
