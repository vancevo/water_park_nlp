import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { subPlaceName, subPlacesFor, type SubPlaces } from './sub-places';

const shipped = (
  JSON.parse(
    readFileSync(join(__dirname, '../public/data/sub-places.json'), 'utf8'),
  ) as { places: SubPlaces }
).places;

describe('sub-places', () => {
  it('finds the children of a place by its slug number', () => {
    expect(subPlacesFor(shipped, 'p05-tram-xe-trung-tam')).toHaveLength(2);
    expect(subPlacesFor(shipped, 'p01-gate')).toEqual([]);
    expect(subPlacesFor(shipped, 'added-on-site')).toEqual([]);
  });

  it('puts the big place 11 around four pinned children, named in both languages', () => {
    const children = subPlacesFor(shipped, 'p11-khu-tro-choi-thieu-nhi');
    expect(children.length).toBeGreaterThan(10);
    const pinned = children.filter((child) => child.pin);
    expect(pinned.map((child) => child.pin)).toEqual([
      '11.1',
      '11.2',
      '11.3',
      '11.4',
    ]);
    for (const child of pinned) {
      expect(child.color).toBeTruthy();
      expect(child.latitude).toBeGreaterThan(10.76);
    }
    for (const child of children) {
      expect(subPlaceName(child, 'vi')).toBeTruthy();
      expect(subPlaceName(child, 'en')).toBeTruthy();
    }
    expect(subPlaceName(children[0]!, 'en')).toBe('Spinning Tower');
  });
});
