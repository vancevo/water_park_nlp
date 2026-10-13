import { describe, expect, it } from 'vitest';

import {
  dashboardRanges,
  isOperatingBucket,
  operatingHours,
} from '../src/operations/dashboard-time.js';

const isoRanges = (now: string) => {
  const ranges = dashboardRanges(new Date(now));
  return Object.fromEntries(
    Object.entries(ranges).map(([name, range]) => [
      name,
      { from: range.from.toISOString(), to: range.to.toISOString() },
    ]),
  );
};

describe('dashboardRanges', () => {
  it('keeps Sunday 23:59 in the previous Vietnam reporting day and week', () => {
    expect(isoRanges('2026-10-11T16:59:59.000Z')).toEqual({
      today: {
        from: '2026-10-10T17:00:00.000Z',
        to: '2026-10-11T17:00:00.000Z',
      },
      yesterday: {
        from: '2026-10-09T17:00:00.000Z',
        to: '2026-10-10T17:00:00.000Z',
      },
      week: {
        from: '2026-10-04T17:00:00.000Z',
        to: '2026-10-11T17:00:00.000Z',
      },
      month: {
        from: '2026-09-30T17:00:00.000Z',
        to: '2026-10-11T17:00:00.000Z',
      },
    });
  });

  it('starts a new day and ISO week at Monday 00:00 Vietnam time', () => {
    expect(isoRanges('2026-10-11T17:00:00.000Z')).toEqual({
      today: {
        from: '2026-10-11T17:00:00.000Z',
        to: '2026-10-12T17:00:00.000Z',
      },
      yesterday: {
        from: '2026-10-10T17:00:00.000Z',
        to: '2026-10-11T17:00:00.000Z',
      },
      week: {
        from: '2026-10-11T17:00:00.000Z',
        to: '2026-10-12T17:00:00.000Z',
      },
      month: {
        from: '2026-09-30T17:00:00.000Z',
        to: '2026-10-12T17:00:00.000Z',
      },
    });
  });

  it('rolls the monthly window over at local midnight', () => {
    expect(isoRanges('2026-10-31T17:00:00.000Z').month).toEqual({
      from: '2026-10-31T17:00:00.000Z',
      to: '2026-11-01T17:00:00.000Z',
    });
  });
});

describe('operating-hour traffic buckets', () => {
  it('keeps 15-minute buckets inside configured Vietnam opening hours', () => {
    const hours = operatingHours({
      OPERATIONS_OPEN_HOUR: '8',
      OPERATIONS_CLOSE_HOUR: '18',
    });
    expect(isOperatingBucket(Date.parse('2026-10-12T00:45:00Z'), hours)).toBe(
      false,
    );
    expect(isOperatingBucket(Date.parse('2026-10-12T01:00:00Z'), hours)).toBe(
      true,
    );
    expect(isOperatingBucket(Date.parse('2026-10-12T10:45:00Z'), hours)).toBe(
      true,
    );
    expect(isOperatingBucket(Date.parse('2026-10-12T11:00:00Z'), hours)).toBe(
      false,
    );
  });

  it('falls back to 08:00-18:00 for an invalid range', () => {
    expect(
      operatingHours({
        OPERATIONS_OPEN_HOUR: '20',
        OPERATIONS_CLOSE_HOUR: '8',
      }),
    ).toEqual({ opensAtHour: 8, closesAtHour: 18 });
  });
});
