import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = join(__dirname, '../public');
const georef = JSON.parse(
  readFileSync(join(publicDir, 'maps/damsen-illustrated.georef.json'), 'utf8'),
) as {
  status: string;
  image: string;
  corners: [number, number][];
  lakeOverlapIoU: number;
  osmFootpathSamplesOnPaintedWater: number;
  northUpBaseline: { lakeOverlapIoU: number };
};

describe('illustrated map georeference', () => {
  it('ships the image it describes', () => {
    expect(existsSync(join(publicDir, 'maps', georef.image))).toBe(true);
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

  it('stays honest: provisional, and better than a north-up guess', () => {
    expect(georef.status).toBe('provisional');
    expect(georef.lakeOverlapIoU).toBeGreaterThan(
      georef.northUpBaseline.lakeOverlapIoU,
    );
    // A rigid fit leaves footpaths on painted water; the report must say so.
    expect(georef.osmFootpathSamplesOnPaintedWater).toBeGreaterThan(0);
  });
});
