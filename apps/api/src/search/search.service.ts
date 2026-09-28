import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  SearchReason,
  SearchResponse,
  SearchResult,
  SupportedLocale,
} from '@damsen/shared-types';

import { distanceMeters } from '../poi/in-memory-poi.repository.js';
import type { PoiRecord } from '../poi/poi.models.js';
import type { SearchQueryDto } from './search.dto.js';
import {
  SEARCH_CLOCK,
  SEARCH_REPOSITORY,
  type SearchCandidate,
  type SearchRepository,
} from './search.models.js';
import { normalizeSearchText } from './search-text.js';

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function vietnamTime(date: Date): { dayOfWeek: number; minutes: number } {
  const local = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  return {
    dayOfWeek: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function recordIsOpen(
  record: PoiRecord,
  at: ReturnType<typeof vietnamTime>,
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
export class SearchService {
  constructor(
    @Inject(SEARCH_REPOSITORY) private readonly repository: SearchRepository,
    @Inject(SEARCH_CLOCK) private readonly now: () => Date,
  ) {}

  async search(query: SearchQueryDto): Promise<SearchResponse> {
    this.validateQuery(query);
    const at = vietnamTime(this.now());
    const candidates = await this.repository.search({
      query: query.q.trim(),
      locale: query.locale,
      category: query.category,
      latitude: query.lat,
      longitude: query.lng,
      radiusMeters: query.radius,
      openAt: query.openNow ? at : undefined,
      limit: query.limit,
      offset: query.offset,
    });
    const total = candidates[0]?.total ?? 0;
    const items = candidates.map((candidate) =>
      this.result(candidate, query.locale, query.lat, query.lng, at),
    );
    const nextOffset = query.offset + items.length;
    return {
      items,
      total,
      limit: query.limit,
      offset: query.offset,
      ...(nextOffset < total ? { nextOffset } : {}),
    };
  }

  private validateQuery(query: SearchQueryDto): void {
    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException('lat and lng must be provided together');
    }
    if (query.radius !== undefined && !hasLat) {
      throw new BadRequestException('radius requires lat and lng');
    }
    if (!normalizeSearchText(query.q)) {
      throw new BadRequestException('q must contain letters or numbers');
    }
  }

  private result(
    candidate: SearchCandidate,
    requestedLocale: SupportedLocale,
    latitude: number | undefined,
    longitude: number | undefined,
    at: ReturnType<typeof vietnamTime>,
  ): SearchResult {
    const translation =
      candidate.record.translations[requestedLocale] ??
      candidate.record.translations.vi;
    if (!translation) {
      throw new BadRequestException('Search result translation is unavailable');
    }
    const isOpen = recordIsOpen(candidate.record, at);
    const distance =
      candidate.distanceMeters ??
      (latitude !== undefined && longitude !== undefined
        ? distanceMeters(
            latitude,
            longitude,
            candidate.record.latitude,
            candidate.record.longitude,
          )
        : undefined);
    const reasons: SearchReason[] = [
      candidate.exactName
        ? 'exact_name'
        : candidate.normalizedName
          ? 'accent_insensitive_name'
          : 'text_match',
      ...(distance !== undefined ? (['nearby'] as const) : []),
      ...(isOpen ? (['open_now'] as const) : []),
    ];
    return {
      id: candidate.record.id,
      slug: candidate.record.slug,
      category: candidate.record.category,
      location: {
        latitude: candidate.record.latitude,
        longitude: candidate.record.longitude,
      },
      requestedLocale,
      resolvedLocale: translation.locale,
      fallbackUsed: translation.locale !== requestedLocale,
      name: translation.name,
      shortDescription: translation.shortDescription,
      isOpen,
      ...(distance === undefined
        ? {}
        : { distanceMeters: Math.round(distance) }),
      score: Number(candidate.textScore.toFixed(6)),
      reasons,
    };
  }
}
