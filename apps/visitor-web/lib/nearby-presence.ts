import type { VisitorPresencePoint } from '@damsen/shared-types';

export function nearbyPresenceFeatureCollection(
  points: Iterable<VisitorPresencePoint>,
  ownPresenceId: string | null,
) {
  return {
    type: 'FeatureCollection' as const,
    features: [...points]
      .filter((point) => point.presenceId !== ownPresenceId)
      .map((point) => ({
        type: 'Feature' as const,
        id: point.presenceId,
        geometry: {
          type: 'Point' as const,
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          presenceId: point.presenceId,
          pseudonym: point.pseudonym,
          avatarVariant: point.avatarVariant,
          locationMode: point.locationMode,
          updatedAt: point.updatedAt,
        },
      })),
  };
}
