import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Zone } from './zones';
import {
  nearestZone,
  resolveZone,
  zoneDistances,
  zoneSpeech,
  zoneText,
} from './zones';

const file = JSON.parse(
  readFileSync(join(import.meta.dirname, '../public/data/zones.json'), 'utf8'),
) as { zones: Zone[] };

describe('zones.json', () => {
  it('has both languages for every text, and unique ids', () => {
    const ids = new Set<string>();
    for (const zone of file.zones) {
      expect(ids.has(zone.id)).toBe(false);
      ids.add(zone.id);
      for (const text of [zone.name, zone.intro, zone.try, zone.tip]) {
        expect(text.vi.length).toBeGreaterThan(10);
        expect(text.en.length).toBeGreaterThan(10);
        expect(text.en).toMatch(/^[\x20-\x7eéÉ–—’']+$/);
      }
      expect(zone.members.length).toBeGreaterThan(2);
    }
  });

  it('lists only places that exist (slugs of the seeded park)', () => {
    const known = new Set<string>();
    const sources = ['damsen-pois.json', 'new-places.json', 'amenities.json'];
    for (const name of sources) {
      const data = JSON.parse(
        readFileSync(
          join(import.meta.dirname, '../../../data/pois', name),
          'utf8',
        ),
      ) as { pois?: { slug: string }[]; places?: { slug: string }[] };
      for (const poi of data.pois ?? data.places ?? []) known.add(poi.slug);
    }
    for (const slug of file.zones.flatMap((zone) => zone.members)) {
      expect(known.has(slug), `${slug} is not a place`).toBe(true);
    }
  });

  it('puts every place in at most one zone', () => {
    const seen = new Map<string, string>();
    for (const zone of file.zones) {
      for (const slug of zone.members) {
        expect(seen.get(slug), `${slug} in two zones`).toBeUndefined();
        seen.set(slug, zone.id);
      }
    }
  });
});

describe('zone resolution', () => {
  const zones: Zone[] = [
    { ...file.zones[0]!, id: 'a', members: ['a1', 'a2'] },
    { ...file.zones[1]!, id: 'b', members: ['b1'] },
  ];
  const at = (latitude: number) => ({ latitude, longitude: 106.64 });
  const locations = new Map([
    ['a1', at(10.766)],
    ['a2', at(10.7661)],
    ['b1', at(10.767)],
  ]);

  it('measures the distance to the nearest place of each zone', () => {
    const d = zoneDistances(at(10.766), zones, locations);
    expect(d.a).toBeLessThan(1);
    expect(d.b).toBeGreaterThan(100);
    expect(nearestZone(d)?.id).toBe('a');
    // unknown places are ignored, a zone with none is absent
    expect(
      zoneDistances(at(10.766), [{ ...zones[0]!, members: ['x'] }], locations),
    ).toEqual({});
  });

  it('enters within 60 m, stays until 90 m, and is null when far', () => {
    expect(resolveZone(null, { a: 55 })).toBe('a');
    expect(resolveZone(null, { a: 65 })).toBeNull();
    expect(resolveZone('a', { a: 85 })).toBe('a');
    expect(resolveZone('a', { a: 95 })).toBeNull();
  });

  it('hands over to another zone only when clearly closer', () => {
    expect(resolveZone('a', { a: 50, b: 45 })).toBe('a');
    expect(resolveZone('a', { a: 70, b: 40 })).toBe('b');
    // the other zone is closer but still outside the enter distance: stay
    expect(resolveZone('a', { a: 88, b: 65 })).toBe('a');
  });
});

describe('zone text', () => {
  const zone = file.zones[0]!;
  it('reads English when asked, Vietnamese otherwise', () => {
    expect(zoneText(zone.name, 'en')).toBe(zone.name.en);
    expect(zoneText(zone.name, 'vi')).toBe(zone.name.vi);
    expect(zoneText(zone.name, 'fr')).toBe(zone.name.vi);
  });

  it('speaks arrival, what is here, what to try and the tip', () => {
    const speech = zoneSpeech(zone, 'en', 'You are arriving.');
    expect(speech.startsWith('You are arriving.')).toBe(true);
    expect(speech).toContain(zone.intro.en);
    expect(speech).toContain(zone.try.en);
    expect(speech.endsWith(zone.tip.en)).toBe(true);
  });
});
