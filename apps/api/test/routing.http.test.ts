import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';

describe('routing HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => app.close());

  it('routes to a POI entrance using the OSM research graph', async () => {
    const response = await fetch(`${baseUrl}/v1/routes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: { lat: 10.7661062, lng: 106.6418258 },
        poiId: '00000000-0000-4000-8000-000000000102',
        accessible: false,
      }),
    });
    const body = (await response.json()) as {
      geometry: { type: string };
      distanceMeters: number;
      steps: unknown[];
    };
    expect(response.status).toBe(201);
    expect(body.geometry.type).toBe('LineString');
    expect(body.distanceMeters).toBeGreaterThan(0);
    expect(body.steps.length).toBeGreaterThan(0);
  });

  it('returns a stable error code outside the routable park area', async () => {
    const response = await fetch(`${baseUrl}/v1/routes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: { lat: 11, lng: 107 },
        poiId: '00000000-0000-4000-8000-000000000105',
      }),
    });
    const body = (await response.json()) as { code: string };
    expect(response.status).toBe(422);
    expect(body.code).toBe('ORIGIN_OUTSIDE_ROUTABLE_AREA');
  });
});
