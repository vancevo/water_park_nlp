import type { PoiOperatingHours, SupportedLocale } from '@damsen/shared-types';

export type PoiStatus = 'draft' | 'pending_review' | 'published' | 'rejected';

export interface PoiTranslationRecord {
  locale: SupportedLocale;
  name: string;
  shortDescription: string;
  longDescription: string;
}

export interface PoiEntranceRecord {
  id: string;
  labelVi: string;
  labelEn: string;
  location: { latitude: number; longitude: number };
  graphNodeRef: string;
  isPrimary: boolean;
  accessibility: 'standard' | 'step_free';
}

export interface PoiRecord {
  id: string;
  slug: string;
  category: string;
  status: PoiStatus;
  latitude: number;
  longitude: number;
  translations: Partial<Record<SupportedLocale, PoiTranslationRecord>>;
  entrances: PoiEntranceRecord[];
  operatingHours: PoiOperatingHours[];
  pendingVersionId?: string;
  rejectionReason?: string;
}

export interface PoiContentVersionRecord {
  id: string;
  poiId: string;
  version: number;
  status: PoiStatus;
  snapshot: PoiRecord;
  createdBy: string;
  reviewedBy?: string;
  reason?: string;
}

export interface PoiAuditRecord {
  id: string;
  actorId: string;
  action: string;
  entityId: string;
  before: PoiRecord | null;
  after: PoiRecord | null;
  createdAt: Date;
}

export interface PoiRepositoryQuery {
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  category?: string;
  openAt?: { dayOfWeek: number; minutes: number };
}

export interface PoiRepository {
  findPublished(query: PoiRepositoryQuery): Promise<PoiRecord[]>;
  findPublishedById(id: string): Promise<PoiRecord | null>;
  findAllForAdmin(): Promise<PoiRecord[]>;
  findForAdmin(id: string): Promise<PoiRecord | null>;
  save(record: PoiRecord): Promise<void>;
  delete(id: string): Promise<void>;
  saveVersion(version: PoiContentVersionRecord): Promise<void>;
  findVersion(id: string): Promise<PoiContentVersionRecord | null>;
  nextVersion(poiId: string): Promise<number>;
  saveAudit(record: PoiAuditRecord): Promise<void>;
  findAudit(): Promise<PoiAuditRecord[]>;
}

export const POI_REPOSITORY = Symbol('POI_REPOSITORY');
export const POI_CLOCK = Symbol('POI_CLOCK');
