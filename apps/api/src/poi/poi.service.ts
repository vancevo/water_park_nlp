import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PoiDetail,
  PoiListResponse,
  PoiSummary,
  SupportedLocale,
} from '@damsen/shared-types';

import { distanceMeters } from './in-memory-poi.repository.js';
import {
  POI_REPOSITORY,
  POI_CLOCK,
  type PoiRecord,
  type PoiRepository,
} from './poi.models.js';
import type { PoiListQueryDto } from './poi-query.dto.js';

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function vietnamTime(date: Date): { dayOfWeek: number; minutes: number } {
  const local = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  return {
    dayOfWeek: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function recordIsOpen(record: PoiRecord, at: ReturnType<typeof vietnamTime>) {
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
export class PoiService {
  constructor(
    @Inject(POI_REPOSITORY) private readonly repository: PoiRepository,
    @Inject(POI_CLOCK) private readonly now: () => Date,
  ) {}

  async list(query: PoiListQueryDto): Promise<PoiListResponse> {
    this.validateSpatialQuery(query);
    const at = vietnamTime(this.now());
    const records = await this.repository.findPublished({
      latitude: query.lat,
      longitude: query.lng,
      radiusMeters: query.radius,
      category: query.category,
      openAt: query.openNow ? at : undefined,
    });
    const items = records.map((record) =>
      this.summary(record, query.locale, query.lat, query.lng, at),
    );
    return { items, total: items.length };
  }

  async detail(id: string, locale: SupportedLocale): Promise<PoiDetail> {
    const record = await this.repository.findPublishedById(id);
    if (!record) throw new NotFoundException('POI not found');
    const translation = this.translation(record, locale);
    return {
      ...this.summary(
        record,
        locale,
        undefined,
        undefined,
        vietnamTime(this.now()),
      ),
      longDescription: translation.longDescription,
      entrances: record.entrances.map((entrance) => ({
        id: entrance.id,
        label: locale === 'en' ? entrance.labelEn : entrance.labelVi,
        location: entrance.location,
        graphNodeRef: entrance.graphNodeRef,
        isPrimary: entrance.isPrimary,
        accessibility: entrance.accessibility,
      })),
      operatingHours: record.operatingHours,
    };
  }

  private validateSpatialQuery(query: PoiListQueryDto): void {
    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException('lat and lng must be provided together');
    }
    if (query.radius !== undefined && !hasLat) {
      throw new BadRequestException('radius requires lat and lng');
    }
  }

  private summary(
    record: PoiRecord,
    requestedLocale: SupportedLocale,
    latitude: number | undefined,
    longitude: number | undefined,
    at: ReturnType<typeof vietnamTime>,
  ): PoiSummary {
    const translation = this.translation(record, requestedLocale);
    const resolvedLocale = translation.locale;
    return {
      id: record.id,
      slug: record.slug,
      category: record.category,
      location: {
        latitude: record.latitude,
        longitude: record.longitude,
      },
      requestedLocale,
      resolvedLocale,
      fallbackUsed: requestedLocale !== resolvedLocale,
      name: translation.name,
      shortDescription: translation.shortDescription,
      isOpen: recordIsOpen(record, at),
      ...(latitude !== undefined && longitude !== undefined
        ? {
            distanceMeters: Math.round(
              distanceMeters(
                latitude,
                longitude,
                record.latitude,
                record.longitude,
              ),
            ),
          }
        : {}),
    };
  }

  private translation(record: PoiRecord, requestedLocale: SupportedLocale) {
    const translation =
      record.translations[requestedLocale] ?? record.translations.vi;
    if (!translation) {
      throw new NotFoundException('Published POI translation not found');
    }
    return translation;
  }
}
