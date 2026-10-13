import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { DemoRateLimiter } from '../src/auth/demo-rate-limiter.js';

const expectRateLimited = (run: () => void) => {
  try {
    run();
    throw new Error('expected rate limit');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  }
};

describe('demo phone rate limiter', () => {
  it('limits a phone hash and resets after the fixed window', () => {
    const limiter = new DemoRateLimiter();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.check('same-phone-hash', {}, 1_000);
    }
    expectRateLimited(() => limiter.check('same-phone-hash', {}, 1_000));
    expect(() => limiter.check('same-phone-hash', {}, 61_000)).not.toThrow();
  });

  it('limits IP, session and device signals independently of phone', () => {
    const cases = [
      { signal: { ip: '127.0.0.1' }, allowed: 60 },
      { signal: { sessionId: 'opaque-session' }, allowed: 20 },
      { signal: { deviceId: 'opaque-device' }, allowed: 20 },
    ];
    for (const { signal, allowed } of cases) {
      const limiter = new DemoRateLimiter();
      for (let attempt = 0; attempt < allowed; attempt += 1) {
        limiter.check(`phone-${attempt}`, signal, 1_000);
      }
      expectRateLimited(() => limiter.check(`phone-${allowed}`, signal, 1_000));
    }
  });
});
