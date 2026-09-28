import { describe, expect, it, vi } from 'vitest';

import { createHttpRouteClient, RouteRequestError } from './httpRouteClient';

describe('HTTP route client', () => {
  it('posts the typed T33 request and normalizes a valid route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          routeId: 'route-1',
          version: 2,
          geometry: {
            type: 'LineString',
            coordinates: [
              [106.635, 10.768],
              [106.636, 10.768],
            ],
          },
          distanceMeters: 110,
          etaSeconds: 90,
          steps: [
            { sequence: 1, instruction: 'Đi thẳng', distanceMeters: 110 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const route = await createHttpRouteClient(
      'https://api.example',
    ).createRoute({
      from: { lat: 10.768, lng: 106.635 },
      poiId: 'poi-1',
      accessible: true,
    });

    expect(route.version).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/routes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          from: { lat: 10.768, lng: 106.635 },
          poiId: 'poi-1',
          accessible: true,
        }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('rejects malformed route geometry at the client boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            routeId: 'route-1',
            version: '1',
            geometry: { type: 'Feature', geometry: { type: 'Point' } },
            distanceMeters: 10,
            etaSeconds: 10,
            steps: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      createHttpRouteClient('https://api.example').createRoute({
        from: { lat: 10.768, lng: 106.635 },
        poiId: 'poi-1',
        accessible: false,
      }),
    ).rejects.toBeInstanceOf(RouteRequestError);
    vi.unstubAllGlobals();
  });
});
