export type SupportedLocale = 'vi' | 'en';

export interface PoiSummary {
  id: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  latitude: number;
  longitude: number;
  imageUrl: string | null;
  isOpen: boolean | null;
}

export interface PoiEntrance {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  isPrimary: boolean;
  accessibility: 'standard' | 'step_free';
}

export interface PoiOperatingHours {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface PoiDetail extends PoiSummary {
  longDescription: string;
  entrances: PoiEntrance[];
  operatingHours: PoiOperatingHours[];
  requestedLocale: SupportedLocale;
  resolvedLocale: SupportedLocale;
  fallbackUsed: boolean;
}

export interface PoiPage {
  items: PoiSummary[];
  nextCursor: string | null;
}

export interface ListPoisInput {
  locale: SupportedLocale;
  signal?: AbortSignal;
}

export interface GetPoiInput {
  id: string;
  locale: SupportedLocale;
  signal?: AbortSignal;
}

/** Boundary that can be implemented by the future generated OpenAPI client. */
export interface PoiClient {
  listPois(input: ListPoisInput): Promise<PoiPage>;
  getPoi(input: GetPoiInput): Promise<PoiDetail>;
}
