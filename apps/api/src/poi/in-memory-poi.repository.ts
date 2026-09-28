import { Injectable } from '@nestjs/common';

import { POI_FIXTURES } from './poi.fixtures.js';
import type {
  PoiAuditRecord,
  PoiContentVersionRecord,
  PoiRecord,
  PoiRepository,
  PoiRepositoryQuery,
} from './poi.models.js';

const EARTH_RADIUS_METERS = 6_371_000;

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function isOpen(
  record: PoiRecord,
  dayOfWeek: number,
  minutes: number,
): boolean {
  return record.operatingHours.some((hours) => {
    if (hours.dayOfWeek !== dayOfWeek) return false;
    const [openHour = 0, openMinute = 0] = hours.opensAt.split(':').map(Number);
    const [closeHour = 0, closeMinute = 0] = hours.closesAt
      .split(':')
      .map(Number);
    return (
      minutes >= openHour * 60 + openMinute &&
      minutes < closeHour * 60 + closeMinute
    );
  });
}

@Injectable()
export class InMemoryPoiRepository implements PoiRepository {
  private readonly records: PoiRecord[];
  private readonly versions = new Map<string, PoiContentVersionRecord>();
  private readonly audit: PoiAuditRecord[] = [];

  constructor(records: readonly PoiRecord[] = POI_FIXTURES) {
    this.records = structuredClone(records) as PoiRecord[];
  }

  async findPublished(query: PoiRepositoryQuery): Promise<PoiRecord[]> {
    const hasPoint =
      query.latitude !== undefined && query.longitude !== undefined;
    return this.records
      .filter((record) => record.status === 'published')
      .filter((record) => !query.category || record.category === query.category)
      .filter(
        (record) =>
          !query.openAt ||
          isOpen(record, query.openAt.dayOfWeek, query.openAt.minutes),
      )
      .filter((record) => {
        if (!hasPoint || query.radiusMeters === undefined) return true;
        return (
          distanceMeters(
            query.latitude!,
            query.longitude!,
            record.latitude,
            record.longitude,
          ) <= query.radiusMeters
        );
      })
      .sort((left, right) => {
        if (!hasPoint) return left.slug.localeCompare(right.slug);
        return (
          distanceMeters(
            query.latitude!,
            query.longitude!,
            left.latitude,
            left.longitude,
          ) -
          distanceMeters(
            query.latitude!,
            query.longitude!,
            right.latitude,
            right.longitude,
          )
        );
      });
  }

  async findPublishedById(id: string): Promise<PoiRecord | null> {
    return (
      this.records.find(
        (record) => record.id === id && record.status === 'published',
      ) ?? null
    );
  }

  async findAllForAdmin(): Promise<PoiRecord[]> {
    return structuredClone(this.records);
  }

  async findForAdmin(id: string): Promise<PoiRecord | null> {
    const record = this.records.find((item) => item.id === id);
    return record ? structuredClone(record) : null;
  }

  async save(record: PoiRecord): Promise<void> {
    const index = this.records.findIndex((item) => item.id === record.id);
    if (index >= 0) this.records[index] = structuredClone(record);
    else this.records.push(structuredClone(record));
  }

  async delete(id: string): Promise<void> {
    const index = this.records.findIndex((item) => item.id === id);
    if (index >= 0) this.records.splice(index, 1);
  }

  async saveVersion(version: PoiContentVersionRecord): Promise<void> {
    this.versions.set(version.id, structuredClone(version));
  }

  async findVersion(id: string): Promise<PoiContentVersionRecord | null> {
    const version = this.versions.get(id);
    return version ? structuredClone(version) : null;
  }

  async nextVersion(poiId: string): Promise<number> {
    return (
      Math.max(
        0,
        ...[...this.versions.values()]
          .filter((item) => item.poiId === poiId)
          .map((item) => item.version),
      ) + 1
    );
  }

  async saveAudit(record: PoiAuditRecord): Promise<void> {
    this.audit.push(structuredClone(record));
  }

  async findAudit(): Promise<PoiAuditRecord[]> {
    return structuredClone(this.audit);
  }
}

export { distanceMeters };
