import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NEW_PLACE_COLORS,
  POI_PIN_COLORS,
  poiPinColor,
} from './poi-pin-colors';

describe('poiPinColor', () => {
  it('reads the colour from the pNN- slug prefix', () => {
    expect(poiPinColor('p01-cong-so-1-duong-lac-long-quan')).toBe('yellow');
    expect(poiPinColor('p04-ride')).toBe('red');
    expect(poiPinColor('p48-garden')).toBe('white');
    expect(poiPinColor('added-on-site')).toBeNull();
  });

  it('matches the pins file for all 50 numbered places', () => {
    const file = JSON.parse(
      readFileSync(
        join(__dirname, '../../../data/walkways-new/pins.json'),
        'utf8',
      ),
    ) as { pins: { number: string; color: string }[] };
    const numbered = file.pins.filter((pin) => !pin.number.includes('.'));
    expect(numbered).toHaveLength(50);
    for (const pin of numbered) {
      expect(POI_PIN_COLORS[Number(pin.number)], pin.number).toBe(pin.color);
    }
  });

  it('colours the new places like the data file says', () => {
    expect(poiPinColor('new-truot-phao-tren-tham')).toBe('red');
    expect(poiPinColor('new-cafe-windy')).toBe('white');
    expect(poiPinColor('new-dao-than-ky')).toBe('white');
    expect(poiPinColor('new-cong-lien-thong')).toBe('yellow');
    expect(poiPinColor('new-unknown')).toBeNull();
    const file = JSON.parse(
      readFileSync(
        join(__dirname, '../../../data/pois/new-places.json'),
        'utf8',
      ),
    ) as { places: { slug: string; pin: string }[] };
    expect(Object.keys(NEW_PLACE_COLORS).sort()).toEqual(
      file.places.map((place) => place.slug).sort(),
    );
    for (const place of file.places) {
      expect(NEW_PLACE_COLORS[place.slug], place.slug).toBe(place.pin);
    }
  });
});
