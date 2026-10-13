import { createHash } from 'node:crypto';

import { HttpException, HttpStatus } from '@nestjs/common';

export interface DemoRequestSignals {
  ip?: string;
  sessionId?: string;
  deviceId?: string;
}

interface Bucket {
  count: number;
  resetsAt: number;
}

const WINDOW_MS = 60_000;
const LIMITS = {
  phone: 10,
  ip: 60,
  session: 20,
  device: 20,
} as const;

const opaqueKey = (kind: keyof typeof LIMITS, value: string) =>
  `${kind}:${createHash('sha256').update(value).digest('hex')}`;

export class DemoRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(phoneHash: string, signals: DemoRequestSignals, now: number): void {
    const keys: Array<[keyof typeof LIMITS, string | undefined]> = [
      ['phone', phoneHash],
      ['ip', signals.ip],
      ['session', signals.sessionId],
      ['device', signals.deviceId],
    ];

    for (const [kind, rawValue] of keys) {
      const value = rawValue?.trim().slice(0, 256);
      if (!value) continue;
      this.increment(opaqueKey(kind, value), LIMITS[kind], now);
    }
  }

  private increment(key: string, limit: number, now: number): void {
    const current = this.buckets.get(key);
    if (!current || current.resetsAt <= now) {
      this.buckets.set(key, { count: 1, resetsAt: now + WINDOW_MS });
      return;
    }
    if (current.count >= limit) {
      throw new HttpException(
        'Too many demo login attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    current.count += 1;
  }
}
