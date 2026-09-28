import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../src/index.js';

describe('loadRuntimeConfig', () => {
  it('uses local infrastructure defaults outside production', () => {
    const config = loadRuntimeConfig({ NODE_ENV: 'test' });

    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toContain('127.0.0.1:64321/damsen');
    expect(config.objectStorage.endpoint).toBe('http://localhost:9000/');
    expect(config.objectStorage.enabled).toBe(true);
    expect(config.auth.accessTokenSecret).toContain('development');
  });

  it('supports explicitly disabling object storage', () => {
    expect(
      loadRuntimeConfig({ NODE_ENV: 'test', S3_ENABLED: 'false' }).objectStorage
        .enabled,
    ).toBe(false);
    expect(() =>
      loadRuntimeConfig({ NODE_ENV: 'test', S3_ENABLED: 'maybe' }),
    ).toThrow('S3_ENABLED');
  });

  it('rejects missing production connections', () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL is required in production',
    );
  });

  it('rejects invalid ports and URLs', () => {
    expect(() => loadRuntimeConfig({ PORT: '0' })).toThrow('PORT');
    expect(() => loadRuntimeConfig({ DATABASE_URL: 'not a url' })).toThrow(
      'DATABASE_URL',
    );
  });
});
