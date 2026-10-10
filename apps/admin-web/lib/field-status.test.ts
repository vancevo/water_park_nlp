import type { AdminPoi, FieldCheck } from '@damsen/shared-types';
import { describe, expect, it } from 'vitest';
import { progress, summarizePois } from './field-status';

const poi = (id: string): AdminPoi =>
  ({
    id,
    slug: id,
    category: 'show',
    status: 'published',
    translations: [],
    entrances: [],
    operatingHours: [],
    location: { latitude: 1, longitude: 1 },
  }) as AdminPoi;
const check = (
  poiId: string,
  createdAt: string,
  extra: Partial<FieldCheck>,
): FieldCheck =>
  ({
    id: `${poiId}-${createdAt}`,
    poiId,
    clientId: createdAt,
    target: 'poi',
    location: { latitude: 1, longitude: 1 },
    accuracyMeters: 5,
    sampleCount: 8,
    outcome: 'confirmed',
    distanceFromCurrentMeters: 0,
    createdBy: 'u',
    createdAt,
    ...extra,
  }) as FieldCheck;

describe('field status', () => {
  it('is unchecked without measurements and follows the latest one', () => {
    const [a, b, c, d] = summarizePois(
      [poi('a'), poi('b'), poi('c'), poi('d')],
      [
        check('b', '2026-10-10T01:00:00Z', { outcome: 'problem' }),
        check('b', '2026-10-10T02:00:00Z', { outcome: 'confirmed' }),
        check('c', '2026-10-10T01:00:00Z', { outcome: 'corrected' }),
        check('d', '2026-10-10T01:00:00Z', {
          outcome: 'corrected',
          appliedAt: '2026-10-10T03:00:00Z',
        }),
      ],
    );
    expect(a?.status).toBe('unchecked');
    expect(b?.status).toBe('confirmed');
    expect(c?.status).toBe('corrected');
    expect(c?.openChecks).toHaveLength(1);
    expect(d?.status).toBe('applied');
    expect(d?.openChecks).toHaveLength(0);
  });

  it('counts progress', () => {
    const summaries = summarizePois(
      [poi('a'), poi('b')],
      [check('a', '2026-10-10T01:00:00Z', {})],
    );
    expect(progress(summaries)).toEqual({ total: 2, checked: 1 });
  });
});
