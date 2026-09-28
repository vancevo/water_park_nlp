import { describe, expect, it, vi } from 'vitest';

import type { RoutingRepository } from '../src/routing/routing.models.js';
import { RoutingService } from '../src/routing/routing.service.js';

function repository(
  overrides: Partial<RoutingRepository> = {},
): RoutingRepository {
  return {
    findDestination: vi
      .fn()
      .mockResolvedValue({ nodeId: 3, externalNodeId: 'N3' }),
    snapOrigin: vi.fn().mockResolvedValue({
      id: 1,
      latitude: 10.767,
      longitude: 106.6347,
      distanceMeters: 2,
    }),
    findPath: vi.fn().mockResolvedValue([
      {
        sequence: 1,
        edgeId: 1,
        edgeName: 'N1-N2',
        distanceMeters: 32.8,
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.6347, 10.767],
            [106.635, 10.767],
          ],
        },
      },
      {
        sequence: 2,
        edgeId: 2,
        edgeName: 'N2-N3',
        distanceMeters: 38.2,
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.635, 10.767],
            [106.63535, 10.767],
          ],
        },
      },
    ]),
    ...overrides,
  };
}

describe('RoutingService', () => {
  it('targets an entrance, joins ordered geometry, and forwards accessibility', async () => {
    const repo = repository();
    const result = await new RoutingService(repo).create({
      from: { lat: 10.767, lng: 106.6347 },
      poiId: '00000000-0000-4000-8000-000000000102',
      accessible: true,
    });
    expect(repo.findPath).toHaveBeenCalledWith(1, 3, true);
    expect(result.geometry.coordinates).toEqual([
      [106.6347, 10.767],
      [106.635, 10.767],
      [106.63535, 10.767],
    ]);
    expect(result.distanceMeters).toBe(71);
    expect(result.etaSeconds).toBe(60);
    expect(result.steps).toHaveLength(2);
  });

  it('rejects an origin beyond the bounded snap radius', async () => {
    const service = new RoutingService(
      repository({ snapOrigin: vi.fn().mockResolvedValue(null) }),
    );
    await expect(
      service.create({
        from: { lat: 11, lng: 107 },
        poiId: '00000000-0000-4000-8000-000000000102',
        accessible: false,
      }),
    ).rejects.toMatchObject({
      response: { code: 'ORIGIN_OUTSIDE_ROUTABLE_AREA' },
    });
  });

  it('returns a distinct no-route error when profile filtering disconnects the graph', async () => {
    const service = new RoutingService(
      repository({ findPath: vi.fn().mockResolvedValue([]) }),
    );
    await expect(
      service.create({
        from: { lat: 10.767, lng: 106.6347 },
        poiId: '00000000-0000-4000-8000-000000000102',
        accessible: true,
      }),
    ).rejects.toMatchObject({ response: { code: 'ROUTE_NOT_FOUND' } });
  });
});
