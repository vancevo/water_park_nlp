import { describe, expect, it } from 'vitest';
import { formatPoiNumber, poiNumber, sortByPoiNumber } from './poi-number';

describe('fixed POI numbers', () => {
  it('reads the number from the slug prefix', () => {
    expect(poiNumber('p25-du-quay-dung')).toBe(25);
    expect(poiNumber('p01-cong-so-1-duong-lac-long-quan')).toBe(1);
    expect(poiNumber('khu-tro-choi-mao-hiem')).toBeNull();
    expect(formatPoiNumber('p07-x')).toBe('07');
    expect(formatPoiNumber('moi-them')).toBe('·');
  });

  it('orders by number whatever the incoming (distance) order', () => {
    const slugs = ['p26-b', 'moi', 'p02-a', 'p25-c'].map((slug) => ({ slug }));
    expect(sortByPoiNumber(slugs).map((item) => item.slug)).toEqual([
      'p02-a',
      'p25-c',
      'p26-b',
      'moi',
    ]);
  });
});
