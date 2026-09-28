import { describe, expect, it } from 'vitest';
import { categoryLabel, formatDistance, formatDuration } from './format';

describe('visitor presentation formatters', () => {
  it('formats walking distances for map cards', () => {
    expect(formatDistance()).toBe('Chưa xác định');
    expect(formatDistance(428.4)).toBe('428 m');
    expect(formatDistance(1540)).toBe('1.5 km');
  });

  it('keeps duration readable and category fallback stable', () => {
    expect(formatDuration(31)).toBe('1 phút');
    expect(formatDuration(610)).toBe('10 phút');
    expect(categoryLabel('garden')).toBe('Vườn cảnh');
    expect(categoryLabel('unknown')).toBe('unknown');
  });
});
