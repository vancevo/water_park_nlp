import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = join(__dirname, '../public');
interface Georef {
  status: string;
  image: string;
  imageLocalOnly?: boolean;
  corners: [number, number][];
}
const read = (file: string) =>
  JSON.parse(readFileSync(join(publicDir, 'maps', file), 'utf8')) as Georef;
const manifest = JSON.parse(
  readFileSync(join(publicDir, 'maps/index.json'), 'utf8'),
) as {
  pictures: {
    id: string;
    url: string;
    georef: string;
    optional?: boolean;
    confidence?: string;
  }[];
};

describe('map picture manifest', () => {
  it('lists pictures whose georeference file exists', () => {
    expect(manifest.pictures.length).toBeGreaterThan(0);
    for (const picture of manifest.pictures) {
      expect(
        existsSync(join(publicDir, picture.georef.replace(/^\//, ''))),
      ).toBe(true);
    }
  });

  it('only third-party artwork may be missing from the repo (optional)', () => {
    for (const picture of manifest.pictures) {
      const present = existsSync(
        join(publicDir, picture.url.replace(/^\//, '')),
      );
      if (!picture.optional) expect(present, picture.id).toBe(true);
    }
  });
});

describe.each(manifest.pictures)('georeference of $id', (picture) => {
  const georef = read(picture.georef.split('/').pop()!);

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

  it('never claims to be verified on site', () => {
    expect(['provisional', 'fitted-to-osm-paths']).toContain(georef.status);
  });
});

describe('quality numbers are recorded', () => {
  it('illustrated 3: painted paths match the OSM footpaths within a few metres', () => {
    const g = read('damsen-illustrated-3.georef.json') as Georef & {
      meanDistanceMetres: number;
      osmPathSamplesWithin3HalfPixels: number;
      rotationDegrees: number;
      startingGuessWithin3HalfPixels: number;
    };
    expect(g.meanDistanceMetres).toBeLessThan(5);
    expect(g.osmPathSamplesWithin3HalfPixels).toBeGreaterThan(0.8);
    expect(g.osmPathSamplesWithin3HalfPixels).toBeGreaterThan(
      g.startingGuessWithin3HalfPixels,
    );
    expect(Math.abs(g.rotationDegrees)).toBeLessThan(2); // drawn north-up
    expect(manifest.pictures[0]?.id).toBe('illustrated3'); // default picture
    expect(manifest.pictures[0]?.confidence).toBe('fitted');
  });

  it('illustrated: beats a north-up guess but leaves footpaths on water', () => {
    const g = read('damsen-illustrated.georef.json') as Georef & {
      lakeOverlapIoU: number;
      osmFootpathSamplesOnPaintedWater: number;
      northUpBaseline: { lakeOverlapIoU: number };
    };
    expect(g.lakeOverlapIoU).toBeGreaterThan(g.northUpBaseline.lakeOverlapIoU);
    expect(g.osmFootpathSamplesOnPaintedWater).toBeGreaterThan(0);
  });

  it('official: affine beats similarity-only on the main lake', () => {
    const g = read('damsen-official.georef.json') as Georef & {
      mainLakeIoU: number;
      similarityOnlyBaseline: { mainLakeIoU: number };
      imageLocalOnly: boolean;
    };
    expect(g.mainLakeIoU).toBeGreaterThan(g.similarityOnlyBaseline.mainLakeIoU);
    expect(g.imageLocalOnly).toBe(true);
  });
});
