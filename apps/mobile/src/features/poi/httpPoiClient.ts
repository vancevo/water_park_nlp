import type {
  PoiClient,
  PoiDetail,
  PoiEntrance,
  PoiOperatingHours,
  PoiPage,
  PoiSummary,
  SupportedLocale,
} from './model';

interface PoiWireItem {
  id: string;
  name: string;
  shortDescription?: string | null;
  category?: string | null;
  location: { latitude: number; longitude: number };
  imageUrl?: string | null;
  isOpen?: boolean | null;
  requestedLocale?: SupportedLocale;
  resolvedLocale?: SupportedLocale;
  fallbackUsed?: boolean;
}

interface PoiWirePage {
  items: PoiWireItem[];
  nextCursor?: string | null;
}

interface PoiWireDetail extends PoiWireItem {
  longDescription?: unknown;
  entrances?: unknown;
  operatingHours?: unknown;
}

export class PoiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PoiRequestError';
  }
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalize(item: PoiWireItem): PoiSummary {
  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    !item.location ||
    !isFiniteCoordinate(item.location.latitude) ||
    !isFiniteCoordinate(item.location.longitude)
  ) {
    throw new PoiRequestError('POI response is invalid.', 502);
  }

  return {
    id: item.id,
    name: item.name,
    description: item.shortDescription ?? null,
    categoryName: item.category ?? null,
    latitude: item.location.latitude,
    longitude: item.location.longitude,
    imageUrl: item.imageUrl ?? null,
    isOpen: item.isOpen ?? null,
  };
}

function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === 'vi' || value === 'en';
}

function normalizeEntrance(value: unknown): PoiEntrance {
  const entrance = value as {
    id?: unknown;
    label?: unknown;
    location?: { latitude?: unknown; longitude?: unknown };
    isPrimary?: unknown;
    accessibility?: unknown;
  };
  if (
    !entrance ||
    typeof entrance.id !== 'string' ||
    typeof entrance.label !== 'string' ||
    !entrance.location ||
    !isFiniteCoordinate(entrance.location.latitude) ||
    !isFiniteCoordinate(entrance.location.longitude) ||
    typeof entrance.isPrimary !== 'boolean' ||
    (entrance.accessibility !== 'standard' &&
      entrance.accessibility !== 'step_free')
  ) {
    throw new PoiRequestError('POI response is invalid.', 502);
  }
  return {
    id: entrance.id,
    label: entrance.label,
    latitude: entrance.location.latitude,
    longitude: entrance.location.longitude,
    isPrimary: entrance.isPrimary,
    accessibility: entrance.accessibility,
  };
}

function normalizeHours(value: unknown): PoiOperatingHours {
  const hours = value as {
    dayOfWeek?: unknown;
    opensAt?: unknown;
    closesAt?: unknown;
  };
  if (
    !hours ||
    !Number.isInteger(hours.dayOfWeek) ||
    (hours.dayOfWeek as number) < 0 ||
    (hours.dayOfWeek as number) > 6 ||
    typeof hours.opensAt !== 'string' ||
    typeof hours.closesAt !== 'string'
  ) {
    throw new PoiRequestError('POI response is invalid.', 502);
  }
  return {
    dayOfWeek: hours.dayOfWeek as number,
    opensAt: hours.opensAt,
    closesAt: hours.closesAt,
  };
}

function normalizeDetail(item: PoiWireDetail): PoiDetail {
  if (
    typeof item.longDescription !== 'string' ||
    !Array.isArray(item.entrances) ||
    !Array.isArray(item.operatingHours) ||
    !isSupportedLocale(item.requestedLocale) ||
    !isSupportedLocale(item.resolvedLocale) ||
    typeof item.fallbackUsed !== 'boolean'
  ) {
    throw new PoiRequestError('POI response is invalid.', 502);
  }
  return {
    ...normalize(item),
    longDescription: item.longDescription,
    entrances: item.entrances.map(normalizeEntrance),
    operatingHours: item.operatingHours.map(normalizeHours),
    requestedLocale: item.requestedLocale,
    resolvedLocale: item.resolvedLocale,
    fallbackUsed: item.fallbackUsed,
  };
}

export function createHttpPoiClient(baseUrl: string): PoiClient {
  return {
    async listPois({ locale, signal }): Promise<PoiPage> {
      const query = new URLSearchParams({ locale });
      const response = await fetch(`${baseUrl}/v1/pois?${query.toString()}`, {
        headers: { Accept: 'application/json' },
        signal,
      });

      if (!response.ok) {
        throw new PoiRequestError('Unable to load places.', response.status);
      }

      const payload = (await response.json()) as PoiWirePage;
      if (!payload || !Array.isArray(payload.items)) {
        throw new PoiRequestError('POI response is invalid.', 502);
      }

      return {
        items: payload.items.map(normalize),
        nextCursor: payload.nextCursor ?? null,
      };
    },
    async getPoi({ id, locale, signal }): Promise<PoiDetail> {
      const query = new URLSearchParams({ locale });
      const response = await fetch(
        `${baseUrl}/v1/pois/${encodeURIComponent(id)}?${query.toString()}`,
        { headers: { Accept: 'application/json' }, signal },
      );

      if (!response.ok) {
        throw new PoiRequestError(
          'Unable to load place details.',
          response.status,
        );
      }

      return normalizeDetail((await response.json()) as PoiWireDetail);
    },
  };
}
