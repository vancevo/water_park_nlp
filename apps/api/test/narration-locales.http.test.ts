import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NarrationLocaleCatalog } from '@damsen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';

describe('narration locale catalog HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.S3_ENABLED = 'false';
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    delete process.env.S3_ENABLED;
    await app.close();
  });

  it('returns the enabled locale catalog', async () => {
    const response = await fetch(`${baseUrl}/v1/narration-locales`);
    expect(response.status).toBe(200);

    const catalog = (await response.json()) as NarrationLocaleCatalog;
    expect(catalog.defaultLocale).toBe('vi');

    const codes = catalog.locales.map((locale) => locale.code);
    expect(codes).toContain('vi');
    expect(codes).toContain('en');

    // The public catalog never leaks the config file path.
    expect(JSON.stringify(catalog)).not.toContain('config/');
  });
});
