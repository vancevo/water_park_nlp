import { Injectable } from '@nestjs/common';

import { distanceMeters } from '../poi/in-memory-poi.repository.js';
import { POI_FIXTURES } from '../poi/poi.fixtures.js';
import type { PoiRecord } from '../poi/poi.models.js';
import type {
  SearchCandidate,
  SearchRepository,
  SearchRepositoryQuery,
} from './search.models.js';
import { lexicalScore, normalizeSearchText } from './search-text.js';

function recordIsOpen(
  record: PoiRecord,
  at: { dayOfWeek: number; minutes: number },
): boolean {
  return record.operatingHours.some((hours) => {
    if (hours.dayOfWeek !== at.dayOfWeek) return false;
    const [openHour = 0, openMinute = 0] = hours.opensAt.split(':').map(Number);
    const [closeHour = 0, closeMinute = 0] = hours.closesAt
      .split(':')
      .map(Number);
    return (
      at.minutes >= openHour * 60 + openMinute &&
      at.minutes < closeHour * 60 + closeMinute
    );
  });
}

@Injectable()
export class InMemorySearchRepository implements SearchRepository {
  constructor(private readonly records: readonly PoiRecord[] = POI_FIXTURES) {}

  async search(query: SearchRepositoryQuery): Promise<SearchCandidate[]> {
    const hasPoint =
      query.latitude !== undefined && query.longitude !== undefined;
    const normalizedQuery = normalizeSearchText(query.query);
    const candidates = this.records
      .filter((record) => record.status === 'published')
      .filter((record) => !query.category || record.category === query.category)
      .filter((record) => !query.openAt || recordIsOpen(record, query.openAt))
      .map((record): SearchCandidate | null => {
        const translation =
          record.translations[query.locale] ?? record.translations.vi;
        if (!translation) return null;
        const score = lexicalScore(
          query.query,
          translation.name,
          `${translation.name} ${translation.shortDescription} ${translation.longDescription} ${record.category}`,
        );
        const distance = hasPoint
          ? distanceMeters(
              query.latitude!,
              query.longitude!,
              record.latitude,
              record.longitude,
            )
          : undefined;
        if (
          query.radiusMeters !== undefined &&
          distance !== undefined &&
          distance > query.radiusMeters
        ) {
          return null;
        }
        // Do not return unrelated records merely because the catalogue is small.
        if (normalizedQuery.length === 0 || score.textScore < 0.55) return null;
        return {
          record,
          ...score,
          textScore: score.textScore + boundedDistanceScore(distance) * 0.2,
          distanceMeters: distance,
          total: 0,
        };
      })
      .filter((candidate): candidate is SearchCandidate => candidate !== null)
      .sort(
        (left, right) =>
          right.textScore - left.textScore ||
          left.record.id.localeCompare(right.record.id),
      );
    return candidates
      .slice(query.offset, query.offset + query.limit)
      .map((candidate) => ({ ...candidate, total: candidates.length }));
  }
}

export function boundedDistanceScore(distanceMeters?: number): number {
  if (distanceMeters === undefined) return 0;
  return 1 / (1 + Math.max(0, distanceMeters) / 250);
}
