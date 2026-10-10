import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POI_PIN_COLORS, poiPinColor } from './poi-pin-colors';

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
});
