import { Injectable } from '@nestjs/common';

import { POI_FIXTURES } from '../poi/poi.fixtures.js';
import type {
  NarrationRecord,
  NarrationRepository,
} from './narration.models.js';

@Injectable()
export class InMemoryNarrationRepository implements NarrationRepository {
  private readonly records = new Map<string, NarrationRecord>();

  constructor(seed: readonly NarrationRecord[] = syntheticNarrations()) {
    for (const record of seed)
      this.records.set(record.id, structuredClone(record));
  }

  async findPublished(
    poiId: string,
    locale: NarrationRecord['locale'],
  ): Promise<NarrationRecord | null> {
    return this.clone(
      [...this.records.values()].find(
        (item) =>
          item.poiId === poiId &&
          item.locale === locale &&
          item.status === 'published',
      ),
    );
  }

  async findByPoi(poiId: string): Promise<NarrationRecord[]> {
    return [...this.records.values()]
      .filter((item) => item.poiId === poiId)
      .sort(
        (a, b) => a.locale.localeCompare(b.locale) || b.revision - a.revision,
      )
      .map((item) => structuredClone(item));
  }

  async findById(id: string): Promise<NarrationRecord | null> {
    return this.clone(this.records.get(id));
  }

  async nextRevision(
    poiId: string,
    locale: NarrationRecord['locale'],
  ): Promise<number> {
    return (
      Math.max(
        0,
        ...[...this.records.values()]
          .filter((item) => item.poiId === poiId && item.locale === locale)
          .map((item) => item.revision),
      ) + 1
    );
  }

  async save(record: NarrationRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async publish(
    id: string,
    reviewerId: string,
    reviewedAt: Date,
  ): Promise<void> {
    const target = this.records.get(id);
    if (!target) return;
    for (const record of this.records.values()) {
      if (
        record.poiId === target.poiId &&
        record.locale === target.locale &&
        record.status === 'published'
      ) {
        record.status = 'superseded';
        record.updatedAt = reviewedAt;
      }
    }
    target.status = 'published';
    target.reviewedBy = reviewerId;
    target.rejectionReason = undefined;
    target.updatedAt = reviewedAt;
  }

  private clone(record: NarrationRecord | undefined): NarrationRecord | null {
    return record ? structuredClone(record) : null;
  }
}

function syntheticNarrations(): NarrationRecord[] {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return POI_FIXTURES.flatMap((poi) =>
    Object.values(poi.translations)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((translation) => ({
        id: `${poi.id.slice(0, -4)}${translation.locale === 'vi' ? '3' : '4'}${poi.id.slice(-3)}`,
        poiId: poi.id,
        locale: translation.locale,
        revision: 1,
        transcript: translation.longDescription,
        status: 'published' as const,
        audio: null,
        createdAt: now,
        updatedAt: now,
      })),
  );
}
