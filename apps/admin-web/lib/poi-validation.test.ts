import { describe, expect, it } from 'vitest';
import {
  DAY_LABELS,
  draftToAdminInput,
  emptyHours,
  emptyPoiDraft,
} from './poi-contract';
import { validatePoi } from './poi-validation';

const complete = () => {
  const draft = emptyPoiDraft();
  draft.slug = 'ho-cuu-long';
  draft.category = 'attraction';
  draft.entrances[0]!.graphNodeRef = 'N1';
  draft.translations.forEach((item) => {
    item.name = 'Name';
    item.shortDescription = 'Short';
    item.longDescription = 'Long';
  });
  return draft;
};
describe('POI form boundary', () => {
  it('uses 0=Sunday and strips closed days from API payload', () => {
    expect(emptyHours().map((item) => item.dayOfWeek)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(DAY_LABELS[0]).toBe('Chủ Nhật');
    const draft = complete();
    draft.operatingHours[0]!.isClosed = true;
    expect(
      draftToAdminInput(draft).operatingHours.some(
        (item) => item.dayOfWeek === 0,
      ),
    ).toBe(false);
  });
  it('requires backend translation, slug, category and entrance fields', () => {
    const errors = validatePoi(emptyPoiDraft());
    expect(errors).toMatchObject({
      slug: expect.any(String),
      category: expect.any(String),
      'translations.vi.name': expect.any(String),
      'translations.en.longDescription': expect.any(String),
      'entrances.0.graphNodeRef': expect.any(String),
    });
  });
  it('accepts a complete POI and rejects invalid hours', () => {
    const draft = complete();
    expect(validatePoi(draft)).toEqual({});
    draft.operatingHours[0] = {
      dayOfWeek: 0,
      opensAt: '18:00',
      closesAt: '08:00',
      isClosed: false,
    };
    expect(validatePoi(draft)['operatingHours.0']).toBeDefined();
  });
  it('never adds narration or media to backend input', () => {
    const payload = draftToAdminInput(complete()) as unknown as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('media');
    expect(JSON.stringify(payload)).not.toContain('narration');
  });
});
