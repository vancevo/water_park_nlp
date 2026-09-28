import type {
  AdminPoi,
  AdminPoiEntranceInput,
  AdminPoiInput,
  AdminPoiTranslationInput,
  PoiOperatingHours,
  PoiWorkflowStatus,
  SupportedLocale,
} from '@damsen/shared-types';

export type Poi = AdminPoi;
export type PoiStatus = PoiWorkflowStatus;
export type Locale = SupportedLocale;
export type PoiTranslation = AdminPoiTranslationInput;
export type PoiEntrance = AdminPoiEntranceInput;

export interface EditableOperatingHour extends PoiOperatingHours {
  isClosed: boolean;
}
export interface PoiDraft {
  slug: string;
  category: string;
  location: AdminPoiInput['location'];
  translations: PoiTranslation[];
  entrances: PoiEntrance[];
  operatingHours: EditableOperatingHour[];
}
export interface PoiQuery {
  status?: PoiStatus | 'all';
  category?: string;
  search?: string;
}
export interface PoiAdminClient {
  list(query?: PoiQuery): Promise<Poi[]>;
  get(id: string): Promise<Poi>;
  create(input: PoiDraft): Promise<Poi>;
  update(id: string, input: PoiDraft): Promise<Poi>;
  remove(id: string): Promise<void>;
  submit(id: string): Promise<Poi>;
  approve(versionId: string): Promise<Poi>;
  reject(versionId: string, reason: string): Promise<Poi>;
}

export const DAY_LABELS: Readonly<Record<number, string>> = {
  0: 'Chủ Nhật',
  1: 'Thứ Hai',
  2: 'Thứ Ba',
  3: 'Thứ Tư',
  4: 'Thứ Năm',
  5: 'Thứ Sáu',
  6: 'Thứ Bảy',
};
export const emptyHours = (): EditableOperatingHour[] =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    opensAt: '08:00',
    closesAt: '18:00',
    isClosed: false,
  }));
export const emptyPoiDraft = (): PoiDraft => ({
  slug: '',
  category: '',
  location: { latitude: 10.7681, longitude: 106.6365 },
  translations: (['vi', 'en'] as const).map((locale) => ({
    locale,
    name: '',
    shortDescription: '',
    longDescription: '',
  })),
  entrances: [
    {
      labelVi: 'Cổng chính',
      labelEn: 'Main entrance',
      location: { latitude: 10.7681, longitude: 106.6365 },
      graphNodeRef: '',
      isPrimary: true,
      accessibility: 'standard',
    },
  ],
  operatingHours: emptyHours(),
});
export function poiToDraft(poi: AdminPoi): PoiDraft {
  const hours = new Map(
    poi.operatingHours.map((item) => [item.dayOfWeek, item]),
  );
  return {
    slug: poi.slug,
    category: poi.category,
    location: structuredClone(poi.location),
    translations: structuredClone(poi.translations),
    entrances: structuredClone(poi.entrances),
    operatingHours: emptyHours().map((fallback) => {
      const hour = hours.get(fallback.dayOfWeek);
      return hour
        ? { ...hour, isClosed: false }
        : { ...fallback, isClosed: true };
    }),
  };
}
/** Strips UI-only closed days. Narration and media are not part of this model/payload. */
export function draftToAdminInput(draft: PoiDraft): AdminPoiInput {
  return {
    slug: draft.slug.trim(),
    category: draft.category.trim(),
    location: structuredClone(draft.location),
    translations: draft.translations.map(
      ({ locale, name, shortDescription, longDescription }) => ({
        locale,
        name: name.trim(),
        shortDescription: shortDescription.trim(),
        longDescription: longDescription.trim(),
      }),
    ),
    entrances: draft.entrances.map((entrance) => ({
      ...structuredClone(entrance),
      labelVi: entrance.labelVi.trim(),
      labelEn: entrance.labelEn.trim(),
      graphNodeRef: entrance.graphNodeRef.trim(),
    })),
    operatingHours: draft.operatingHours
      .filter((hour) => !hour.isClosed)
      .map(({ dayOfWeek, opensAt, closesAt }) => ({
        dayOfWeek,
        opensAt,
        closesAt,
      })),
  };
}
