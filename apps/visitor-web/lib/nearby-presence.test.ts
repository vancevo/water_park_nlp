import type { VisitorPresencePoint } from '@damsen/shared-types';
import { describe, expect, it } from 'vitest';

import { nearbyPresenceFeatureCollection } from './nearby-presence';

function point(index: number): VisitorPresencePoint {
  return {
    presenceId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    pseudonym: `Ẩn danh ${index}`,
    avatarVariant: index % 8,
    latitude: 10.7658 + index / 10_000_000,
    longitude: 106.6416 + index / 10_000_000,
    locationMode: index % 2 ? 'shared' : 'simulated',
    updatedAt: '2026-10-13T06:00:00.000Z',
  };
}

describe('nearby visitor GeoJSON', () => {
  it('filters the caller and converts 1,000 points in one collection', () => {
    const points = Array.from({ length: 1_000 }, (_, index) => point(index));
    const result = nearbyPresenceFeatureCollection(
      points,
      points[500]!.presenceId,
    );

    expect(result.features).toHaveLength(999);
    expect(
      result.features.some((feature) => feature.id === points[500]!.presenceId),
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hasPaidTicket');
  });
});
