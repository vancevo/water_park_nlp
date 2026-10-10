import type { AdminPoi } from '@damsen/shared-types';
import { describe, expect, it } from 'vitest';
import { countByTab, missingForSubmit } from './review-queue';

const poi = (extra: Partial<AdminPoi>): AdminPoi =>
  ({
    id: 'p',
    slug: 'p',
    category: 'show',
    status: 'draft',
    location: { latitude: 1, longitude: 1 },
    translations: [
      {
        locale: 'vi',
        name: 'Tên',
        shortDescription: 'a',
        longDescription: 'a',
      },
      {
        locale: 'en',
        name: 'Name',
        shortDescription: 'a',
        longDescription: 'a',
      },
    ],
    entrances: [
      {
        labelVi: 'v',
        labelEn: 'e',
        graphNodeRef: 'osm-1',
        isPrimary: true,
        accessibility: 'standard',
        location: { latitude: 1, longitude: 1 },
      },
    ],
    operatingHours: [],
    ...extra,
  }) as AdminPoi;

describe('review queue', () => {
  it('counts places per tab', () => {
    expect(
      countByTab([
        poi({ status: 'pending_review' }),
        poi({ status: 'pending_review' }),
        poi({ status: 'draft' }),
        poi({ status: 'published' }),
        poi({ status: 'rejected' }),
      ]),
    ).toEqual({ pending_review: 2, draft: 1, rejected: 1 });
  });

  it('explains what blocks a submit', () => {
    expect(missingForSubmit(poi({}))).toEqual([]);
    expect(missingForSubmit(poi({ translations: [], entrances: [] }))).toEqual([
      'thiếu tên tiếng Việt',
      'thiếu tên tiếng Anh',
      'cần đúng một cổng chính',
    ]);
  });
});
