import type { FieldCheckOutcome, FieldCheckTarget } from '@damsen/shared-types';

export interface FieldCheckRecord {
  id: string;
  /** Generated on the device: a retried upload (bad signal) never duplicates. */
  clientId: string;
  poiId: string;
  target: FieldCheckTarget;
  entranceId?: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  sampleCount: number;
  outcome: FieldCheckOutcome;
  pathOk?: boolean;
  note?: string;
  /** Observed point vs the POI / entrance position at the time of the check. */
  distanceFromCurrentMeters: number;
  createdBy: string;
  createdAt: Date;
  appliedAt?: Date;
  appliedBy?: string;
}

export interface FieldCheckQuery {
  poiId?: string;
  /** Only checks nobody has applied yet. */
  unappliedOnly?: boolean;
  limit: number;
}

export interface FieldCheckRepository {
  /** Inserts, or returns the existing row for the same `clientId`. */
  create(
    record: FieldCheckRecord,
  ): Promise<{ record: FieldCheckRecord; created: boolean }>;
  find(id: string): Promise<FieldCheckRecord | null>;
  list(query: FieldCheckQuery): Promise<FieldCheckRecord[]>;
  markApplied(id: string, appliedBy: string, appliedAt: Date): Promise<void>;
}

export const FIELD_CHECK_REPOSITORY = Symbol('FIELD_CHECK_REPOSITORY');
