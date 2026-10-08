import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETENTION_POLICY,
  isExpired,
  loadRetentionPolicy,
  selectExpiredJobs,
  type RetainableJob,
} from '../src/ops/retention.js';

const NOW = new Date('2026-10-08T00:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function job(overrides: Partial<RetainableJob>): RetainableJob {
  return {
    id: 'j',
    status: 'succeeded',
    deadLettered: false,
    updatedAt: daysAgo(1),
    ...overrides,
  };
}

describe('retention', () => {
  it('expires terminal jobs older than their window', () => {
    expect(
      isExpired(
        job({ status: 'failed', updatedAt: daysAgo(31) }),
        DEFAULT_RETENTION_POLICY,
        NOW,
      ),
    ).toBe(true);
    expect(
      isExpired(
        job({ status: 'failed', updatedAt: daysAgo(29) }),
        DEFAULT_RETENTION_POLICY,
        NOW,
      ),
    ).toBe(false);
  });

  it('never expires in-flight jobs', () => {
    expect(
      isExpired(
        job({ status: 'queued', updatedAt: daysAgo(999) }),
        DEFAULT_RETENTION_POLICY,
        NOW,
      ),
    ).toBe(false);
    expect(
      isExpired(
        job({ status: 'running', updatedAt: daysAgo(999) }),
        DEFAULT_RETENTION_POLICY,
        NOW,
      ),
    ).toBe(false);
  });

  it('uses the dead-letter window for dead-lettered jobs', () => {
    const dead = job({
      status: 'failed',
      deadLettered: true,
      updatedAt: daysAgo(60),
    });
    // 60d < 90d dead-letter window, but > 30d failed window → kept.
    expect(isExpired(dead, DEFAULT_RETENTION_POLICY, NOW)).toBe(false);
    expect(
      isExpired(
        { ...dead, updatedAt: daysAgo(91) },
        DEFAULT_RETENTION_POLICY,
        NOW,
      ),
    ).toBe(true);
  });

  it('selects expired ids oldest first', () => {
    const ids = selectExpiredJobs(
      [
        job({ id: 'new', status: 'cancelled', updatedAt: daysAgo(10) }),
        job({ id: 'old', status: 'cancelled', updatedAt: daysAgo(100) }),
        job({ id: 'mid', status: 'cancelled', updatedAt: daysAgo(40) }),
      ],
      DEFAULT_RETENTION_POLICY,
      NOW,
    );
    expect(ids).toEqual(['old', 'mid']); // 'new' (10d) within 30d window
  });

  it('loads policy from env with fallbacks', () => {
    const policy = loadRetentionPolicy({
      TTS_RETENTION_SUCCEEDED_DAYS: '365',
      TTS_RETENTION_FAILED_DAYS: '0',
    });
    expect(policy.succeededMaxAgeDays).toBe(365);
    expect(policy.failedMaxAgeDays).toBe(30); // 0 rejected → fallback
  });
});
