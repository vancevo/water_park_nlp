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
    expect(config.demo.enabled).toBe(false);
    expect(config.realtime.redisEnabled).toBe(false);
    expect(config.demo.paymentProcessingDelayMs).toBe(2_000);
  });

  it('validates the opt-in realtime Redis switch', () => {
    expect(
      loadRuntimeConfig({
        NODE_ENV: 'test',
        REALTIME_REDIS_ENABLED: 'true',
      }).realtime.redisEnabled,
    ).toBe(true);
    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'test',
        REALTIME_REDIS_ENABLED: 'sometimes',
      }),
    ).toThrow('REALTIME_REDIS_ENABLED');
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

  it('allows demo features only behind DEMO_MODE outside production', () => {
    const config = loadRuntimeConfig({
      NODE_ENV: 'test',
      DEMO_MODE: 'true',
      DEMO_PHONE_AUTH_ENABLED: 'true',
      DEMO_PAYMENTS_ENABLED: 'true',
      DEMO_PAYMENT_PROCESSING_DELAY_MS: '5',
    });
    expect(config.demo).toMatchObject({
      enabled: true,
      phoneAuthEnabled: true,
      paymentsEnabled: true,
      paymentProcessingDelayMs: 5,
    });

    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'test',
        DEMO_PHONE_AUTH_ENABLED: 'true',
      }),
    ).toThrow('DEMO_MODE=true');
    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
        DATABASE_URL: 'postgresql://example.test/db',
        REDIS_URL: 'redis://example.test:6379',
        S3_ENDPOINT: 'https://s3.example.test',
        S3_REGION: 'test',
        S3_BUCKET: 'test',
        S3_ACCESS_KEY: 'test',
        S3_SECRET_KEY: 'test',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        REFRESH_TOKEN_SECRET: 'b'.repeat(32),
        DEMO_PHONE_HMAC_SECRET: 'c'.repeat(32),
      }),
    ).toThrow('forbidden in production');
  });
});
