import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';

describe('public search HTTP API', () => {
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

  it('searches published POIs without Vietnamese accents', async () => {
    const response = await fetch(
      `${baseUrl}/v1/search?q=quang%20truong%20la%20ma&locale=vi&limit=1`,
    );
    const body = (await response.json()) as {
      total: number;
      limit: number;
      offset: number;
      items: Array<{ name: string; reasons: string[] }>;
    };
    expect(response.status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.items[0]?.name).toBe('Quảng trường La Mã');
    expect(body.items[0]?.reasons).toContain('accent_insensitive_name');
  });

  it('returns the common error envelope for invalid spatial input', async () => {
    const response = await fetch(`${baseUrl}/v1/search?q=garden&lat=10.767`);
    const body = (await response.json()) as {
      code: string;
      requestId: string;
    };
    expect(response.status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.requestId).toBeTruthy();
  });
});
