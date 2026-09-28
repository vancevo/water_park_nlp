import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';

describe('public POI HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists and filters published POIs', async () => {
    const response = await fetch(
      `${baseUrl}/v1/pois?lat=10.7614385239&lng=106.6364528573&radius=20&category=landmark&locale=en`,
    );
    const body = (await response.json()) as {
      total: number;
      items: Array<{ name: string }>;
    };
    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items[0]?.name).toBe('The Castle');
  });

  it('returns localized detail and 404 for an absent POI', async () => {
    const response = await fetch(
      `${baseUrl}/v1/pois/00000000-0000-4000-8000-000000000101?locale=vi`,
    );
    const body = (await response.json()) as {
      name: string;
      entrances: unknown[];
      operatingHours: unknown[];
    };
    expect(response.status).toBe(200);
    expect(body.name).toBe('Lâu Đài');
    expect(body.entrances).toHaveLength(1);
    expect(body.operatingHours).toHaveLength(7);

    const missing = await fetch(
      `${baseUrl}/v1/pois/00000000-0000-4000-8000-000000009999`,
    );
    expect(missing.status).toBe(404);
  });

  it('validates malformed queries using the common error envelope', async () => {
    const response = await fetch(`${baseUrl}/v1/pois?lat=10&locale=fr`);
    const body = (await response.json()) as {
      code: string;
      details: string[];
      requestId: string;
    };
    expect(response.status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.details.length).toBeGreaterThan(0);
    expect(body.requestId).toBeTruthy();
  });
});
