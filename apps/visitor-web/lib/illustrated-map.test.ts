import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ILLUSTRATED_MAP_GEOREF, ILLUSTRATED_MAP_URL } from './map-pictures';

const publicDir = join(__dirname, '../public');
const georef = JSON.parse(
  readFileSync(join(publicDir, ILLUSTRATED_MAP_GEOREF), 'utf8'),
) as {
  status: string;
  image: string;
  corners: [number, number][];
  rotationDegrees: number;
  meanDistanceMetres: number;
  osmPathSamplesWithin3HalfPixels: number;
};

describe('illustrated map georeference', () => {
  it('ships the image it describes', () => {
    expect(existsSync(join(publicDir, ILLUSTRATED_MAP_URL))).toBe(true);
    expect(ILLUSTRATED_MAP_URL.endsWith(georef.image)).toBe(true);
  });

  it('has four corners around the park, in lon/lat order', () => {
    expect(georef.corners).toHaveLength(4);
    for (const [lon, lat] of georef.corners) {
      expect(lon).toBeGreaterThan(106.62);
      expect(lon).toBeLessThan(106.65);
      expect(lat).toBeGreaterThan(10.75);
      expect(lat).toBeLessThan(10.78);
    }
  });

  it('is a convex quad in the order MapLibre expects (TL, TR, BR, BL)', () => {
    const cross = (a: number[], b: number[], c: number[]) =>
      (b[0]! - a[0]!) * (c[1]! - b[1]!) - (b[1]! - a[1]!) * (c[0]! - b[0]!);
    const signs = georef.corners.map((_, i) =>
      Math.sign(
        cross(
          georef.corners[i]!,
          georef.corners[(i + 1) % 4]!,
          georef.corners[(i + 2) % 4]!,
        ),
      ),
    );
    expect(new Set(signs).size).toBe(1);
  });

  it('is fitted to the OSM footpaths within about a metre, north-up', () => {
    expect(georef.status).toBe('fitted-to-osm-paths'); // never "verified on site"
    expect(georef.meanDistanceMetres).toBeLessThan(1.5);
    expect(georef.osmPathSamplesWithin3HalfPixels).toBeGreaterThan(0.9);
    expect(Math.abs(georef.rotationDegrees)).toBeLessThan(2);
  });
});
