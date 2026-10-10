import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  compassWord,
  describeOffset,
  formatMetres,
} from './geo-math';

const here = { latitude: 10.766, longitude: 106.638 };

describe('geo math', () => {
  it('computes compass bearings', () => {
    expect(bearingDegrees(here, { ...here, latitude: 10.767 })).toBeCloseTo(
      0,
      0,
    );
    expect(bearingDegrees(here, { ...here, longitude: 106.639 })).toBeCloseTo(
      90,
      0,
    );
    expect(bearingDegrees(here, { ...here, latitude: 10.765 })).toBeCloseTo(
      180,
      0,
    );
    expect(bearingDegrees(here, { ...here, longitude: 106.637 })).toBeCloseTo(
      270,
      0,
    );
  });

  it('names directions in Vietnamese', () => {
    expect(compassWord(0)).toBe('Bắc');
    expect(compassWord(44)).toBe('Đông Bắc');
    expect(compassWord(181)).toBe('Nam');
    expect(compassWord(359)).toBe('Bắc');
  });

  it('describes where a place is relative to the user', () => {
    expect(describeOffset(here, here)).toBe('ngay tại đây');
    // 0.0004° east ≈ 44 m
    expect(describeOffset(here, { ...here, longitude: 106.6384 })).toMatch(
      /^4[0-9] m về hướng Đông$/,
    );
  });

  it('formats distances', () => {
    expect(formatMetres(42.4)).toBe('42 m');
    expect(formatMetres(1530)).toBe('1.53 km');
  });
});
